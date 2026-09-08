import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  RenderJobSchema,
  RenderQualitySchema,
  type CreateRenderInput,
  type RenderFailure,
  type RenderJob,
  type RenderQuality,
} from '@reel/contracts';
import type { Prisma } from '@reel/db';
import { Queue } from 'bullmq';
import * as fs from 'fs';
import { PrismaService } from '../../prisma/prisma.service';
import {
  JobNames,
  QueueNames,
  RENDER_MAX_ATTEMPTS,
  RENDER_RETRY_DELAY_MS,
  type RenderJobPayload,
} from './render.constants';
import { queueFailure } from './render.errors';

type RenderRow = {
  id: string;
  projectId: string;
  status: string;
  stage: string;
  quality: string;
  progress: number;
  attemptCount: number;
  maxAttempts: number;
  cancelRequested: boolean;
  checkpoint: string;
  outputUrl: string | null;
  outputPath: string | null;
  fileName: string | null;
  error: string | null;
  errorDetail: string | null;
  failureCode: string | null;
  failureCategory: string | null;
  failureLevel: string | null;
  failureStage: string | null;
  retryable: boolean;
  startedAt: Date | null;
  nextRetryAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function safeBaseName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .trim()
      .slice(0, 100) || 'export'
  );
}

function failureColumns(failure: RenderFailure) {
  return {
    error: failure.message,
    errorDetail: failure.detail,
    failureCode: failure.code,
    failureCategory: failure.category,
    failureLevel: failure.level,
    failureStage: failure.stage,
    retryable: failure.retryable,
  };
}

@Injectable()
export class RenderService implements OnModuleInit {
  private readonly logger = new Logger(RenderService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QueueNames.RENDER) private readonly queue: Queue<RenderJobPayload>,
  ) {}

  async onModuleInit(): Promise<void> {
    const interrupted = await this.prisma.renderJob.findMany({
      where: { status: { in: ['queued', 'rendering', 'retrying', 'cancelling'] } },
    });

    for (const row of interrupted) {
      try {
        if (row.cancelRequested || row.status === 'cancelling') {
          await this.markCancelled(row);
          continue;
        }

        const existing = await this.queue.getJob(row.id);
        if (existing) {
          const state = await existing.getState();
          if (['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'].includes(state)) {
            continue;
          }
          await existing.remove().catch(() => undefined);
        }

        if (row.attemptCount >= row.maxAttempts) {
          await this.prisma.renderJob.update({
            where: { id: row.id },
            data: {
              status: 'failed',
              finishedAt: new Date(),
              error: row.error || '服务恢复时发现任务已用完自动重试次数',
              failureCode: row.failureCode || 'RECOVERY_ATTEMPTS_EXHAUSTED',
              failureCategory: row.failureCategory || 'system',
              failureLevel: 'exhausted',
              failureStage: row.failureStage || row.stage,
              retryable: true,
            },
          });
          continue;
        }

        await this.prisma.renderJob.update({
          where: { id: row.id },
          data: {
            status: row.attemptCount > 0 ? 'retrying' : 'queued',
            nextRetryAt: null,
          },
        });
        await this.addQueueJob({
          id: row.id,
          userId: row.userId,
          projectId: row.projectId,
          quality: RenderQualitySchema.parse(row.quality),
          maxAttempts: row.maxAttempts,
          attemptCount: row.attemptCount,
        });
        this.logger.log(`Recovered render job ${row.id} from checkpoint ${row.checkpoint}`);
      } catch (error) {
        this.logger.error(
          `Failed to recover render job ${row.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private toRenderJob(row: RenderRow): RenderJob {
    const failure = row.failureCode
      ? {
          code: row.failureCode,
          category: row.failureCategory,
          stage: row.failureStage,
          level: row.failureLevel,
          retryable: row.retryable,
          message: row.error,
          detail: row.errorDetail,
        }
      : null;
    return RenderJobSchema.parse({ ...row, failure });
  }

  private async addQueueJob(input: {
    id: string;
    userId: string;
    projectId: string;
    quality: RenderQuality;
    maxAttempts: number;
    attemptCount: number;
  }): Promise<void> {
    const remainingAttempts = Math.max(1, input.maxAttempts - input.attemptCount);
    await this.queue.add(
      JobNames.RENDER_PROJECT,
      {
        renderJobId: input.id,
        userId: input.userId,
        projectId: input.projectId,
        quality: input.quality,
      },
      {
        jobId: input.id,
        attempts: remainingAttempts,
        backoff: { type: 'exponential', delay: RENDER_RETRY_DELAY_MS },
        removeOnComplete: 50,
        removeOnFail: 100,
      },
    );
  }

  async enqueue(userId: string, input: CreateRenderInput): Promise<RenderJob> {
    const active = await this.prisma.renderJob.findFirst({
      where: {
        userId,
        projectId: input.projectId,
        status: { in: ['queued', 'rendering', 'retrying', 'cancelling'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (active) return this.toRenderJob(active);

    const project = await this.prisma.project.findFirst({
      where: { id: input.projectId, userId, deletedAt: null },
    });
    if (!project) throw new NotFoundException(`Project ${input.projectId} not found`);

    const base = safeBaseName(input.fileName?.trim() || project.name);
    const fileName = `${base}.mp4`;
    const row = await this.prisma.renderJob.create({
      data: {
        userId,
        projectId: input.projectId,
        status: 'queued',
        stage: 'queued',
        quality: input.quality,
        progress: 0,
        maxAttempts: RENDER_MAX_ATTEMPTS,
        checkpoint: 'none',
        fileName,
        timelineSnapshot: project.timeline as Prisma.InputJsonValue,
      },
    });

    try {
      await this.addQueueJob({
        id: row.id,
        userId,
        projectId: input.projectId,
        quality: input.quality,
        maxAttempts: row.maxAttempts,
        attemptCount: 0,
      });
    } catch (error) {
      const failure = queueFailure(error);
      const failed = await this.prisma.renderJob.update({
        where: { id: row.id },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          ...failureColumns(failure),
        },
      });
      return this.toRenderJob(failed);
    }

    return this.toRenderJob(row);
  }

  async findLatest(userId: string, projectId: string): Promise<RenderJob | null> {
    const row = await this.prisma.renderJob.findFirst({
      where: { userId, projectId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toRenderJob(row) : null;
  }

  async findOne(userId: string, id: string): Promise<RenderJob> {
    const row = await this.prisma.renderJob.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException(`RenderJob ${id} not found`);
    return this.toRenderJob(row);
  }

  async cancel(userId: string, id: string): Promise<RenderJob> {
    const row = await this.prisma.renderJob.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException(`RenderJob ${id} not found`);
    if (['completed', 'failed', 'cancelled'].includes(row.status)) return this.toRenderJob(row);

    const cancelling = await this.prisma.renderJob.update({
      where: { id },
      data: { status: 'cancelling', cancelRequested: true, nextRetryAt: null },
    });

    const queueJob = await this.queue.getJob(id);
    if (!queueJob) return this.toRenderJob(await this.markCancelled(cancelling));

    const state = await queueJob.getState();
    if (state === 'active') return this.toRenderJob(cancelling);

    await queueJob.remove().catch(() => undefined);
    return this.toRenderJob(await this.markCancelled(cancelling));
  }

  private async markCancelled<T extends { id: string; stage: string; outputPath: string | null }>(
    row: T,
  ) {
    if (row.outputPath)
      await fs.promises.rm(row.outputPath, { force: true }).catch(() => undefined);
    return this.prisma.renderJob.update({
      where: { id: row.id },
      data: {
        status: 'cancelled',
        cancelRequested: true,
        finishedAt: new Date(),
        nextRetryAt: null,
        error: '导出已由用户取消',
        errorDetail: null,
        failureCode: 'USER_CANCELLED',
        failureCategory: 'cancelled',
        failureLevel: 'cancelled',
        failureStage: row.stage,
        retryable: false,
      },
    });
  }
}
