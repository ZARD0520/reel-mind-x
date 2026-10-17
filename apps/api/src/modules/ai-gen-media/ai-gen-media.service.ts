import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import {
  AssetSchema,
  type Asset,
  type AssetReference,
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
    private readonly config: ConfigService<Env, true>,
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
  ): Promise<AssetReference[]> {
    if (imageAssetIds.length === 0) return [];
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
      select: { id: true, localPath: true, name: true, url: true },
    });
    if (assets.length !== uniqueIds.length || assets.some((asset) => !asset.localPath)) {
      throw new BadRequestException('首尾帧必须是当前画布中已生成完成的图片');
    }
    return imageAssetIds.map((assetId) => {
      const asset = assets.find((candidate) => candidate.id === assetId)!;
      return { kind: 'image', name: asset.name, url: asset.url ?? undefined, assetId };
    });
  }

  async generateImage(userId: string, input: GenerateImageInput): Promise<Asset> {
    const { prompt, size } = input;
    const model = input.model ?? this.config.get('GLM_IMAGE_MODEL', { infer: true });
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
        prompt: input.userPrompt ?? prompt,
        references: input.references ?? [],
        model,
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
    const { prompt, size, duration, withAudio, imageAssetIds = [] } = input;
    const model = input.model ?? this.config.get('GLM_VIDEO_MODEL', { infer: true });
    await this.assertScopeOwned(userId, input);
    const frameReferences = await this.assertImageAssetsReady(userId, input, imageAssetIds);
    const references = [...(input.references ?? [])];
    for (const frame of frameReferences) {
      if (!references.some((reference) => reference.kind === 'image' && reference.assetId === frame.assetId)) references.push(frame);
    }
    if (references.length > 100) throw new BadRequestException('参考内容最多支持 100 项');
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
        prompt: input.userPrompt ?? prompt,
        references,
        model,
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
