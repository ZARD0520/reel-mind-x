import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetSchema, type Asset, type GenerateImageInput, type GenerateVideoInput } from '@reel/contracts';
import type { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import {
  JobNames,
  QueueNames,
  type GenerateImageJobPayload,
  type GenerateVideoJobPayload,
} from './ai-gen-media.constants';

/** BullMQ job 默认可靠性配置（遵循 bullmq.md）。 */
const JOB_OPTS = {
  attempts: 2,
  backoff: { type: 'exponential' as const, delay: 3000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

/**
 * AI 图像/视频生成服务：
 * - 图像：同步 job（5-10s），status 直接变 ready
 * - 视频：异步 job（几分钟），status=generating，前端轮询
 */
@Injectable()
export class AiGenMediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @InjectQueue(QueueNames.AI_GEN_MEDIA) private readonly queue: Queue,
  ) {}

  /** 提交图像生成任务（返回 Asset placeholder，job 异步完成） */
  async generateImage(input: GenerateImageInput): Promise<Asset> {
    const { prompt, size } = input;
    const assetId = randomUUID();

    // 创建 Asset 占位符（status=generating）
    const row = await this.prisma.asset.create({
      data: {
        id: assetId,
        kind: 'image',
        source: 'ai',
        status: 'generating',
        name: `AI 图片：${prompt.slice(0, 30)}`,
        url: null,
        localPath: null,
        width: null,
        height: null,
        durationInFrames: null,
        prompt,
      },
    });

    // 入队：BullMQ job 调用智谱 API + 下载 + 更新 Asset
    await this.queue.add(
      JobNames.GENERATE_IMAGE,
      { assetId, prompt, size } as GenerateImageJobPayload,
      JOB_OPTS,
    );

    return AssetSchema.parse(row);
  }

  /** 提交视频生成任务（返回 Asset placeholder，job 异步轮询智谱） */
  async generateVideo(input: GenerateVideoInput): Promise<Asset> {
    const { prompt } = input;
    const assetId = randomUUID();

    // 创建 Asset 占位符（status=generating）
    const row = await this.prisma.asset.create({
      data: {
        id: assetId,
        kind: 'video',
        source: 'ai',
        status: 'generating',
        name: `AI 视频：${prompt.slice(0, 30)}`,
        url: null,
        localPath: null,
        width: null,
        height: null,
        durationInFrames: null,
        prompt,
      },
    });

    // 入队：BullMQ job 轮询智谱异步任务 → 下载 → 更新 Asset
    await this.queue.add(
      JobNames.GENERATE_VIDEO,
      { assetId, prompt } as GenerateVideoJobPayload,
      JOB_OPTS,
    );

    return AssetSchema.parse(row);
  }
}
