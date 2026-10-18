import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiGenError, ZhipuAiGenProvider } from '@reel/ai-gen';
import { LlmError } from '@reel/llm';
import {
  MODEL_BUSY_MESSAGE,
  type CreateGenerationTaskInput,
  type GeneratedText,
} from '@reel/contracts';
import { Prisma } from '@reel/db';
import type { Job } from 'bullmq';
import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { imageSize } from 'image-size';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { TextGenService } from '../text-gen/text-gen.service';
import { probeMedia } from '../assets/media-probe';
import { GENERATION_QUEUE, GenerationTasksService } from './generation-tasks.service';

class LeaseLost extends Error {}
class MediaSaveError extends Error {}
const MAX_BUSY_SUBMISSION_ATTEMPTS = 2; // Initial submission + one retry.
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const retryDelay = (attempt: number, base = 15000) =>
  Math.min(120000, base * 2 ** Math.max(0, attempt - 1)) * (1 + Math.random() * 0.2);
const isRejected = (error: unknown) =>
  (error instanceof AiGenError || error instanceof LlmError) &&
  error.status !== undefined &&
  error.status >= 400 &&
  error.status < 500 &&
  error.status !== 408;

@Processor(GENERATION_QUEUE, { concurrency: 3 })
export class GenerationTasksProcessor extends WorkerHost {
  private readonly logger = new Logger(GenerationTasksProcessor.name);
  private readonly provider: ZhipuAiGenProvider;
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: GenerationTasksService,
    private readonly config: ConfigService<Env, true>,
    private readonly text: TextGenService,
  ) {
    super();
    this.provider = new ZhipuAiGenProvider({
      apiKey: config.get('GLM_API_KEY', { infer: true }),
      baseUrl: config.get('GLM_BASE_URL', { infer: true }),
      imageModel: config.get('GLM_IMAGE_MODEL', { infer: true }),
      videoModel: config.get('GLM_VIDEO_MODEL', { infer: true }),
    });
  }

  async process(job: Job<{ id: string; revision: number }>) {
    const token = randomUUID();
    const claim = await this.prisma.generationTaskItem.updateMany({
      where: {
        id: job.data.id,
        revision: job.data.revision,
        status: { in: ['queued', 'submitting', 'generating', 'saving'] },
        nextRunAt: { lte: new Date() },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: new Date() } }],
      },
      data: {
        leaseToken: token,
        leaseExpiresAt: new Date(Date.now() + 90000),
        revision: { increment: 1 },
      },
    });
    if (!claim.count) return;
    const item = await this.prisma.generationTaskItem.findUnique({
      where: { id: job.data.id },
      include: { task: true },
    });
    if (!item) return;
    const input = item.task.input as unknown as CreateGenerationTaskInput;
    const controller = new AbortController();
    const heartbeat = setInterval(() => {
      void this.prisma.generationTaskItem
        .updateMany({
          where: { id: item.id, leaseToken: token },
          data: { leaseExpiresAt: new Date(Date.now() + 90000) },
        })
        .then((result) => {
          if (!result.count) controller.abort(new LeaseLost());
        })
        .catch(() => controller.abort(new LeaseLost()));
    }, 15000);
    heartbeat.unref();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]);
    let phase = item.status;
    const transition = async (
      data: Prisma.GenerationTaskItemUpdateManyMutationInput,
      asset?: Prisma.AssetUpdateInput,
    ) => {
      await this.prisma.$transaction(async (tx) => {
        const changed = await tx.generationTaskItem.updateMany({
          where: { id: item.id, leaseToken: token },
          data,
        });
        if (!changed.count) throw new LeaseLost();
        if (asset && item.assetId)
          await tx.asset.update({ where: { id: item.assetId }, data: asset });
      });
    };
    const fail = (message: string, errorCode: string, unknown = false) =>
      transition(
        { status: unknown ? 'unknown' : 'failed', error: message, errorCode },
        { status: unknown ? 'generating' : 'failed', error: message },
      );

    try {
      if (!item.assetId) {
        await fail('生成素材已被移除', 'ASSET_REMOVED');
        return;
      }
      if (phase === 'submitting') {
        // A previous process stopped between sending and persisting the response. Never resubmit.
        await fail('提交结果待确认，请勿重复生成', 'SUBMISSION_UNKNOWN', true);
      } else if (phase === 'queued') {
        if (item.errorCode === 'MODEL_BUSY' && item.attemptCount >= MAX_BUSY_SUBMISSION_ATTEMPTS) {
          await fail(MODEL_BUSY_MESSAGE, 'MODEL_BUSY');
          return;
        }
        const imageUrls =
          input.kind === 'video'
            ? await this.encodeImages(item.task.userId, input.imageAssetIds)
            : [];
        await transition(
          {
            status: 'submitting',
            submittedAt: new Date(),
            attemptCount: { increment: 1 },
            error: null,
            errorCode: null,
          },
          { error: null },
        );
        phase = 'submitting';
        if (input.kind === 'video') {
          const providerTaskId = await this.provider.submitVideo({ ...input, imageUrls, signal });
          await transition({
            status: 'generating',
            providerTaskId,
            nextRunAt: new Date(Date.now() + 5000),
          });
        } else if (input.kind === 'image') {
          const result = await this.provider.generateImage({ ...input, signal });
          await transition({
            status: 'saving',
            providerResult: json(result),
            nextRunAt: new Date(),
          });
        } else {
          const result = await this.text.generateContent(
            { ...input, maxLength: input.maxLength },
            signal,
          );
          await transition({
            status: 'saving',
            providerResult: json(result),
            nextRunAt: new Date(),
          });
        }
      } else if (phase === 'generating') {
        if (!item.providerTaskId) {
          await fail('缺少第三方任务标识，结果待确认', 'SUBMISSION_UNKNOWN', true);
          return;
        }
        const result = await this.provider.getVideoResult(item.providerTaskId, signal);
        if (result.status === 'completed') {
          await transition({
            status: 'saving',
            providerResult: json({ url: result.url, model: item.task.model }),
            error: null,
            errorCode: null,
            pollFailures: 0,
            nextRunAt: new Date(),
          });
        } else if (result.status === 'failed') {
          await fail(result.error, 'PROVIDER_FAILED');
        } else if (item.submittedAt && Date.now() - item.submittedAt.getTime() > 30 * 60 * 1000) {
          await fail('生成时间较长，结果待确认，可继续查询原任务', 'QUERY_UNAVAILABLE', true);
        } else {
          await transition({
            nextRunAt: new Date(Date.now() + 5000),
            error: null,
            pollFailures: 0,
          });
        }
      } else if (phase === 'saving') {
        await transition({ saveAttempts: { increment: 1 } });
        if (!item.providerResult) {
          await fail('生成结果缺失，请联系支持', 'RESULT_MISSING');
          return;
        }
        if (input.kind === 'text') {
          const result = item.providerResult as unknown as GeneratedText;
          await transition(
            { status: 'completed', completedAt: new Date(), error: null, errorCode: null },
            { status: 'ready', content: result.text, model: result.model, error: null },
          );
        } else {
          const result = item.providerResult as { url: string; model: string };
          const media = await this.saveMedia(
            item.id,
            token,
            item.task.userId,
            input.kind,
            result.url,
            signal,
          );
          await transition(
            { status: 'completed', completedAt: new Date(), error: null, errorCode: null },
            { status: 'ready', error: null, model: result.model, ...media },
          );
        }
      }
    } catch (error) {
      if (error instanceof LeaseLost || controller.signal.aborted) return;
      this.logger.warn(`Generation item ${item.id}, stage ${phase}: ${(error as Error).message}`);
      const busy =
        (error instanceof AiGenError || error instanceof LlmError) && error.status === 429;
      if (phase === 'submitting') {
        // One automatic retry after an explicit rejection; then let the user switch models.
        if (busy && item.attemptCount + 1 < MAX_BUSY_SUBMISSION_ATTEMPTS) {
          await transition(
            {
              status: 'queued',
              error: MODEL_BUSY_MESSAGE,
              errorCode: 'MODEL_BUSY',
              nextRunAt: new Date(Date.now() + retryDelay(item.attemptCount + 1)),
            },
            { error: MODEL_BUSY_MESSAGE },
          );
        } else if (isRejected(error)) {
          await fail(
            busy ? MODEL_BUSY_MESSAGE : '模型请求被拒绝，请检查参数或模型权限',
            busy ? 'MODEL_BUSY' : 'SUBMISSION_REJECTED',
          );
        } else {
          await fail('提交结果待确认，请勿重复生成', 'SUBMISSION_UNKNOWN', true);
        }
      } else if (phase === 'generating') {
        if (item.pollFailures + 1 >= 10)
          await fail(
            busy ? MODEL_BUSY_MESSAGE : '暂时无法查询生成结果，请稍后继续查询原任务',
            'QUERY_UNAVAILABLE',
            true,
          );
        else
          await transition({
            pollFailures: { increment: 1 },
            error: busy ? MODEL_BUSY_MESSAGE : '查询暂时失败，正在重试',
            errorCode: 'QUERY_RETRY',
            nextRunAt: new Date(Date.now() + retryDelay(item.pollFailures + 1, 5000)),
          });
      } else if (phase === 'saving') {
        if (item.saveAttempts + 1 >= 5)
          await fail(
            error instanceof MediaSaveError
              ? error.message
              : '素材已生成，但保存失败，请稍后重试保存',
            'SAVE_FAILED',
          );
        else
          await transition({
            error: '素材已生成，正在重试保存',
            errorCode: 'SAVE_RETRY',
            nextRunAt: new Date(Date.now() + retryDelay(item.saveAttempts + 1, 5000)),
          });
      } else await fail('参考素材暂不可用，请检查依赖后重新生成', 'PREPARATION_FAILED');
    } finally {
      clearInterval(heartbeat);
      await this.prisma.generationTaskItem.updateMany({
        where: { id: item.id, leaseToken: token },
        data: { leaseToken: null, leaseExpiresAt: null },
      });
      await this.tasks.refresh(item.taskId);
    }
  }

  private async encodeImages(userId: string, ids: string[]) {
    const rows = ids.length
      ? await this.prisma.asset.findMany({
          where: { id: { in: ids }, userId, kind: 'image', status: 'ready' },
          select: { id: true, localPath: true },
        })
      : [];
    return Promise.all(
      ids.map(async (id) => {
        const localPath = rows.find((row) => row.id === id)?.localPath;
        if (!localPath) throw new Error('Reference image unavailable');
        const buffer = await fs.readFile(localPath);
        const format = imageFormat(buffer);
        if (!format) throw new Error('Unsupported reference image format');
        return `data:image/${format};base64,${buffer.toString('base64')}`;
      }),
    );
  }

  private async saveMedia(
    id: string,
    token: string,
    userId: string,
    kind: 'image' | 'video',
    remoteUrl: string,
    signal: AbortSignal,
  ) {
    const directory = path.resolve(
      this.config.get('STORAGE_DIR', { infer: true }),
      'users',
      userId,
      'uploads',
    );
    await fs.mkdir(directory, { recursive: true });
    const candidates = kind === 'image' ? ['png', 'jpeg', 'webp', 'gif', 'avif'] : ['mp4'];
    for (const extension of candidates) {
      const filename = `${id}.${extension}`;
      const file = path.join(directory, filename);
      try {
        await fs.access(file);
      } catch {
        continue;
      }
      const probe = kind === 'image'
        ? imageMetadata(await fs.readFile(file))
        : await probeMedia(file, `${kind}/${extension}`, 30);
      if (!probe?.width || !probe.height) continue;
      return {
        url: `/files/users/${userId}/uploads/${filename}`,
        localPath: file,
        width: probe.width,
        height: probe.height,
        durationInFrames: probe.durationInFrames,
      };
    }
    const response = await fetch(remoteUrl, { signal });
    if (!response.ok)
      throw new MediaSaveError(
        response.status === 403 || response.status === 404 || response.status === 410
          ? `素材已生成，但结果链接暂不可用（${response.status}），请稍后重试保存`
          : `素材已生成，但下载失败（${response.status}），请稍后重试保存`,
      );
    const buffer = Buffer.from(await response.arrayBuffer());
    const extension = kind === 'image' ? imageFormat(buffer) : 'mp4';
    if (!extension) throw new MediaSaveError('模型返回的图片格式无效或不支持，无法保存');
    const filename = `${id}.${extension}`;
    const file = path.join(directory, filename);
    const temporary = path.join(directory, `${id}-${token}.${extension}`);
    await fs.writeFile(temporary, buffer);
    try {
      // Images do not need an OS-specific ffprobe executable to read their dimensions.
      const probe = kind === 'image'
        ? imageMetadata(buffer)
        : await probeMedia(temporary, `${kind}/${extension}`, 30);
      if (!probe?.width || !probe.height) throw new MediaSaveError('模型返回的素材无效，无法保存');
      await fs.rename(temporary, file);
      return {
        url: `/files/users/${userId}/uploads/${filename}`,
        localPath: file,
        width: probe.width,
        height: probe.height,
        durationInFrames: probe.durationInFrames,
      };
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
    }
  }
}

function imageMetadata(buffer: Buffer) {
  try {
    const dimensions = imageSize(buffer);
    const type = dimensions.type;
    if (!type || !['jpg', 'png', 'webp', 'gif', 'avif'].includes(type) ||
        !dimensions.width || !dimensions.height) return null;
    return {
      extension: type === 'jpg' ? 'jpeg' : type,
      width: dimensions.width,
      height: dimensions.height,
      durationInFrames: null,
    };
  } catch {
    return null;
  }
}

function imageFormat(buffer: Buffer): string | null {
  return imageMetadata(buffer)?.extension ?? null;
}
