import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { AssetSchema, type Asset, type GenerateImageInput, type GenerateVideoInput } from '@reel/contracts';
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

  async generateImage(userId: string, input: GenerateImageInput): Promise<Asset> {
    const { prompt, size } = input;
    const assetId = randomUUID();

    const row = await this.prisma.asset.create({
      data: {
        id: assetId,
        userId,
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
      { userId, assetId, prompt, size } as GenerateImageJobPayload,
      JOB_OPTS,
    );

    return AssetSchema.parse(row);
  }

  async generateVideo(userId: string, input: GenerateVideoInput): Promise<Asset> {
    const { prompt, size } = input;
    const assetId = randomUUID();

    const row = await this.prisma.asset.create({
      data: {
        id: assetId,
        userId,
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
      { userId, assetId, prompt, size } as GenerateVideoJobPayload,
      JOB_OPTS,
    );

    return AssetSchema.parse(row);
  }
}
