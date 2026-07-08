import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AiMixJobSchema,
  AssetSchema,
  ProjectSchema,
  type AiMixJob,
  type Asset,
  type CreateAiMixInput,
} from '@reel/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { generateAdMixTimeline } from './ai-mix.generator';

const jobs = new Map<string, AiMixJob>();
const jobOwners = new Map<string, string>();

@Injectable()
export class AiMixService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, input: CreateAiMixInput): Promise<AiMixJob> {
    const projectRow = await this.prisma.project.findFirst({
      where: { id: input.projectId, userId, deletedAt: null },
    });
    if (!projectRow) throw new NotFoundException(`Project ${input.projectId} not found`);

    const assetRows = await this.prisma.asset.findMany({
      where: { userId, id: { in: input.assetIds } },
    });
    if (assetRows.length === 0) throw new BadRequestException('Please select at least one asset');

    const assets = assetRows
      .map((row) => AssetSchema.parse(row) as Asset)
      .filter((asset) => asset.status === 'ready' && input.assetIds.includes(asset.id));
    if (assets.length === 0) throw new BadRequestException('Selected assets are not ready');
    if (!assets.some((asset) => asset.kind === 'video' || asset.kind === 'image')) {
      throw new BadRequestException('Please select at least one video or image asset');
    }

    const project = ProjectSchema.parse(projectRow);
    const draftTimeline = generateAdMixTimeline(project.timeline, assets, input);
    const job = AiMixJobSchema.parse({
      id: randomUUID(),
      projectId: input.projectId,
      status: 'completed',
      progress: 100,
      draftTimeline,
      error: null,
      createdAt: new Date(),
    });
    jobs.set(job.id, job);
    jobOwners.set(job.id, userId);
    return job;
  }

  findOne(userId: string, id: string): AiMixJob {
    const job = jobs.get(id);
    if (!job || jobOwners.get(id) !== userId) throw new NotFoundException(`AiMixJob ${id} not found`);
    return job;
  }
}
