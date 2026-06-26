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

@Injectable()
export class AiMixService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateAiMixInput): Promise<AiMixJob> {
    const projectRow = await this.prisma.project.findUnique({ where: { id: input.projectId } });
    if (!projectRow) throw new NotFoundException(`Project ${input.projectId} not found`);

    const assetRows = await this.prisma.asset.findMany({ where: { id: { in: input.assetIds } } });
    if (assetRows.length === 0) throw new BadRequestException('请选择至少一个可用素材');

    const assets = assetRows
      .map((row) => AssetSchema.parse(row) as Asset)
      .filter((asset) => asset.status === 'ready' && input.assetIds.includes(asset.id));
    if (assets.length === 0) throw new BadRequestException('选择的素材还未就绪');
    if (!assets.some((asset) => asset.kind === 'video' || asset.kind === 'image')) {
      throw new BadRequestException('请选择至少一个视频或图片素材');
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
    return job;
  }

  findOne(id: string): AiMixJob {
    const job = jobs.get(id);
    if (!job) throw new NotFoundException(`AiMixJob ${id} not found`);
    return job;
  }
}
