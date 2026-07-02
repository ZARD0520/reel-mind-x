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

// MVP：素材时长按参考 fps 折算成帧
const REFERENCE_FPS = 30;

/**
 * AI 图像/视频生成 processor：
 * 1. 调用智谱 API 获取临时 URL
 * 2. 下载到 server storage
 * 3. probe 元信息
 * 4. 更新 Asset 状态
 */
@Processor(QueueNames.AI_GEN_MEDIA)
export class AiGenMediaProcessor extends WorkerHost {
  private readonly logger = new Logger(AiGenMediaProcessor.name);
  private readonly provider: ZhipuAiGenProvider;
  private readonly storageDir: string;
  private readonly publicUrl: string;

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
    this.storageDir = path.resolve(this.config.get('STORAGE_DIR', { infer: true }), 'uploads');
    this.publicUrl = this.config.get('PUBLIC_URL', { infer: true });
    fs.mkdirSync(this.storageDir, { recursive: true });
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

  /** 图像生成：调 CogView → 下载 → probe → 更新 Asset */
  private async processImage(job: Job<GenerateImageJobPayload>): Promise<void> {
    const { assetId, prompt, size } = job.data;
    this.logger.log(`图像生成 ${assetId} 开始: ${prompt.slice(0, 40)}`);
    try {
      const result = await this.provider.generateImage({ prompt, size });
      await this.downloadAndFinalize(assetId, result.url, 'image', 'png');
      this.logger.log(`图像生成 ${assetId} 完成`);
    } catch (err) {
      await this.markFailed(assetId, err);
      throw err;
    }
  }

  /** 视频生成：调 CogVideoX（轮询）→ 下载 → probe → 更新 Asset */
  private async processVideo(job: Job<GenerateVideoJobPayload>): Promise<void> {
    const { assetId, prompt } = job.data;
    this.logger.log(`视频生成 ${assetId} 开始: ${prompt.slice(0, 40)}`);
    try {
      const result = await this.provider.generateVideo({ prompt });
      await this.downloadAndFinalize(assetId, result.url, 'video', 'mp4');
      this.logger.log(`视频生成 ${assetId} 完成`);
    } catch (err) {
      await this.markFailed(assetId, err);
      throw err;
    }
  }

  /** 下载远程 URL 到本地 storage，probe 元信息，更新 Asset 为 ready */
  private async downloadAndFinalize(
    assetId: string,
    remoteUrl: string,
    kind: 'image' | 'video',
    ext: string,
  ): Promise<void> {
    const filename = `${randomUUID()}.${ext}`;
    const localPath = path.join(this.storageDir, filename);

    // 下载到本地
    const res = await fetch(remoteUrl);
    if (!res.ok) throw new Error(`下载生成结果失败 (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.promises.writeFile(localPath, buffer);

    // probe 元信息（宽高/时长）
    const mimetype = kind === 'image' ? `image/${ext}` : `video/${ext}`;
    const probe = await probeMedia(localPath, mimetype, REFERENCE_FPS);

    await this.prisma.asset.update({
      where: { id: assetId },
      data: {
        status: 'ready',
        url: `${this.publicUrl}/static/uploads/${filename}`,
        localPath,
        width: probe.width,
        height: probe.height,
        durationInFrames: probe.durationInFrames,
      },
    });
  }

  /** 标记生成失败 */
  private async markFailed(assetId: string, err: unknown): Promise<void> {
    this.logger.error(`生成 ${assetId} 失败: ${(err as Error).message}`);
    await this.prisma.asset
      .update({ where: { id: assetId }, data: { status: 'failed' } })
      .catch(() => undefined);
  }
}
