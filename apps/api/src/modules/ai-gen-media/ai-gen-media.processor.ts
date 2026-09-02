import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ZhipuAiGenProvider } from '@reel/ai-gen';
import type { Job } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { probeMedia } from '../assets/media-probe';
import {
  JobNames,
  QueueNames,
  type GenerateImageJobPayload,
  type GenerateVideoJobPayload,
} from './ai-gen-media.constants';

const REFERENCE_FPS = 30;

function detectImageFormat(
  content: Buffer,
): { mime: 'image/jpeg' | 'image/png'; ext: 'jpg' | 'png' } | null {
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (
    content.length >= 8 &&
    content[0] === 0x89 &&
    content[1] === 0x50 &&
    content[2] === 0x4e &&
    content[3] === 0x47
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  return null;
}

@Processor(QueueNames.AI_GEN_MEDIA)
export class AiGenMediaProcessor extends WorkerHost {
  private readonly logger = new Logger(AiGenMediaProcessor.name);
  private readonly provider: ZhipuAiGenProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
    this.provider = new ZhipuAiGenProvider({
      apiKey: this.config.get('GLM_API_KEY', { infer: true }),
      baseUrl: this.config.get('GLM_BASE_URL', { infer: true }),
      imageModel: this.config.get('GLM_IMAGE_MODEL', { infer: true }),
      videoModel: this.config.get('GLM_VIDEO_MODEL', { infer: true }),
    });
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === JobNames.GENERATE_IMAGE) {
      return this.processImage(job as Job<GenerateImageJobPayload>);
    }
    if (job.name === JobNames.GENERATE_VIDEO) {
      return this.processVideo(job as Job<GenerateVideoJobPayload>);
    }
    throw new Error(`Unknown job name: ${job.name}`);
  }

  private async processImage(job: Job<GenerateImageJobPayload>): Promise<void> {
    const { userId, assetId, prompt, size, model } = job.data;
    this.logger.log(`Image generation ${assetId} started`);
    try {
      const result = await this.provider.generateImage({ prompt, size, model });
      await this.downloadAndFinalize(userId, assetId, result.url, 'image', 'png');
      this.logger.log(`Image generation ${assetId} completed`);
    } catch (err) {
      await this.markFailed(assetId, err);
      throw err;
    }
  }

  private async processVideo(job: Job<GenerateVideoJobPayload>): Promise<void> {
    const {
      userId,
      assetId,
      prompt,
      size,
      duration,
      withAudio,
      model,
      imageAssetIds = [],
    } = job.data;
    this.logger.log(`Video generation ${assetId} started`);
    try {
      const imageUrls = await this.encodeImageAssets(userId, imageAssetIds);
      const result = await this.provider.generateVideo({
        prompt,
        size,
        duration,
        withAudio,
        model,
        imageUrls,
      });
      await this.downloadAndFinalize(userId, assetId, result.url, 'video', 'mp4');
      this.logger.log(`Video generation ${assetId} completed`);
    } catch (err) {
      await this.markFailed(assetId, err);
      throw err;
    }
  }

  private async encodeImageAssets(userId: string, imageAssetIds: string[]): Promise<string[]> {
    if (imageAssetIds.length === 0) return [];
    const rows = await this.prisma.asset.findMany({
      where: { id: { in: imageAssetIds }, userId, kind: 'image', status: 'ready' },
      select: { id: true, localPath: true },
    });
    return Promise.all(
      imageAssetIds.map(async (id) => {
        const localPath = rows.find((row) => row.id === id)?.localPath;
        if (!localPath) throw new Error(`Reference image asset ${id} is unavailable`);
        const content = await fs.promises.readFile(localPath);
        const format = detectImageFormat(content);
        if (!format) throw new Error(`Reference image asset ${id} is not a supported PNG or JPEG`);
        return `data:${format.mime};base64,${content.toString('base64')}`;
      }),
    );
  }

  private async downloadAndFinalize(
    userId: string,
    assetId: string,
    remoteUrl: string,
    kind: 'image' | 'video',
    ext: string,
  ): Promise<void> {
    const storageDir = path.resolve(
      this.config.get('STORAGE_DIR', { infer: true }),
      'users',
      userId,
      'uploads',
    );
    await fs.promises.mkdir(storageDir, { recursive: true });

    const res = await fetch(remoteUrl);
    if (!res.ok) throw new Error(`Generated media download failed (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const imageFormat = kind === 'image' ? detectImageFormat(buffer) : null;
    const resolvedExt = imageFormat?.ext ?? ext;
    const filename = `${randomUUID()}.${resolvedExt}`;
    const localPath = path.join(storageDir, filename);
    await fs.promises.writeFile(localPath, buffer);

    const mimetype = kind === 'image' ? (imageFormat?.mime ?? `image/${ext}`) : `video/${ext}`;
    const probe = await probeMedia(localPath, mimetype, REFERENCE_FPS);

    await this.prisma.asset.update({
      where: { id: assetId },
      data: {
        status: 'ready',
        url: `/files/users/${userId}/uploads/${filename}`,
        localPath,
        width: probe.width,
        height: probe.height,
        durationInFrames: probe.durationInFrames,
      },
    });
  }

  private async markFailed(assetId: string, err: unknown): Promise<void> {
    this.logger.error(`Generation ${assetId} failed: ${(err as Error).message}`);
    await this.prisma.asset
      .update({ where: { id: assetId }, data: { status: 'failed' } })
      .catch(() => undefined);
  }
}
