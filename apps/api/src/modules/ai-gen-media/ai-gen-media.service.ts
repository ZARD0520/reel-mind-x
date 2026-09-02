import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AssetSchema,
  type Asset,
  type GenerateImageInput,
  type GenerateVideoInput,
} from '@reel/contracts';
import type { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  JobNames,
  QueueNames,
  type GenerateImageJobPayload,
  type GenerateVideoJobPayload,
} from './ai-gen-media.constants';

const JOB_OPTS = {
  attempts: 2,
  backoff: { type: 'exponential' as const, delay: 3000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

@Injectable()
export class AiGenMediaService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QueueNames.AI_GEN_MEDIA) private readonly queue: Queue,
  ) {}

  private async assertScopeOwned(
    userId: string,
    input: { projectId?: string; canvasId?: string },
  ): Promise<void> {
    const scope = input.projectId
      ? await this.prisma.project.findFirst({
          where: { id: input.projectId, userId, deletedAt: null },
          select: { id: true },
        })
      : await this.prisma.canvas.findFirst({
          where: { id: input.canvasId, userId },
          select: { id: true },
        });
    if (!scope) throw new NotFoundException('Generation scope not found');
  }

  private scopeData(input: { projectId?: string; canvasId?: string }) {
    return input.projectId ? { projectId: input.projectId } : { canvasId: input.canvasId! };
  }

  private async assertImageAssetsReady(
    userId: string,
    input: { projectId?: string; canvasId?: string },
    imageAssetIds: string[],
  ): Promise<void> {
    if (imageAssetIds.length === 0) return;
    const uniqueIds = [...new Set(imageAssetIds)];
    if (uniqueIds.length !== imageAssetIds.length) {
      throw new BadRequestException('首帧和尾帧不能使用同一个图片素材');
    }
    const assets = await this.prisma.asset.findMany({
      where: {
        id: { in: uniqueIds },
        userId,
        kind: 'image',
        status: 'ready',
        ...this.scopeData(input),
      },
      select: { id: true, localPath: true },
    });
    if (assets.length !== uniqueIds.length || assets.some((asset) => !asset.localPath)) {
      throw new BadRequestException('首尾帧必须是当前画布中已生成完成的图片');
    }
  }

  async generateImage(userId: string, input: GenerateImageInput): Promise<Asset> {
    const { prompt, size, model } = input;
    await this.assertScopeOwned(userId, input);
    const assetId = randomUUID();

    const row = await this.prisma.asset.create({
      data: {
        id: assetId,
        userId,
        ...this.scopeData(input),
        kind: 'image',
        source: 'ai',
        status: 'generating',
        name: `AI Image: ${prompt.slice(0, 30)}`,
        url: null,
        localPath: null,
        width: null,
        height: null,
        durationInFrames: null,
        prompt,
      },
    });

    await this.queue.add(
      JobNames.GENERATE_IMAGE,
      { userId, ...this.scopeData(input), assetId, prompt, size, model } as GenerateImageJobPayload,
      JOB_OPTS,
    );

    return AssetSchema.parse(row);
  }

  async generateVideo(userId: string, input: GenerateVideoInput): Promise<Asset> {
    const { prompt, size, duration, withAudio, model, imageAssetIds = [] } = input;
    await this.assertScopeOwned(userId, input);
    await this.assertImageAssetsReady(userId, input, imageAssetIds);
    const assetId = randomUUID();

    const row = await this.prisma.asset.create({
      data: {
        id: assetId,
        userId,
        ...this.scopeData(input),
        kind: 'video',
        source: 'ai',
        status: 'generating',
        name: `AI Video: ${prompt.slice(0, 30)}`,
        url: null,
        localPath: null,
        width: null,
        height: null,
        durationInFrames: null,
        prompt,
      },
    });

    await this.queue.add(
      JobNames.GENERATE_VIDEO,
      {
        userId,
        ...this.scopeData(input),
        assetId,
        prompt,
        size,
        duration,
        withAudio,
        model,
        imageAssetIds,
      } as GenerateVideoJobPayload,
      JOB_OPTS,
    );

    return AssetSchema.parse(row);
  }
}
