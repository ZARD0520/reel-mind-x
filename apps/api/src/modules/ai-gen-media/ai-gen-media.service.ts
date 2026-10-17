import { Injectable } from '@nestjs/common';
import type { Asset, GenerateImageInput, GenerateVideoInput } from '@reel/contracts';
import { randomUUID } from 'crypto';
import { GenerationTasksService } from '../generation-tasks/generation-tasks.service';

@Injectable()
export class AiGenMediaService {
  constructor(private readonly tasks: GenerationTasksService) {}

  async generateImage(userId: string, input: GenerateImageInput): Promise<Asset> {
    const task = await this.tasks.create(userId, {
      ...input,
      kind: 'image',
      requestId: input.requestId ?? randomUUID(),
    });
    return { ...task.items[0]!.asset!, generationTaskId: task.id };
  }

  async generateVideo(userId: string, input: GenerateVideoInput): Promise<Asset> {
    const task = await this.tasks.create(userId, {
      ...input,
      kind: 'video',
      requestId: input.requestId ?? randomUUID(),
    });
    return { ...task.items[0]!.asset!, generationTaskId: task.id };
  }
}
