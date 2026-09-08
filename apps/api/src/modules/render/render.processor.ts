import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TimelineSchema,
  type RenderCheckpoint,
  type RenderFailure,
  type RenderStage,
  type Timeline,
} from '@reel/contracts';
import type { Prisma } from '@reel/db';
import { Job, UnrecoverableError } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { probeMedia } from '../assets/media-probe';
import {
  QueueNames,
  RENDER_CANCEL_POLL_MS,
  RENDER_RETRY_DELAY_MS,
  type RenderJobPayload,
} from './render.constants';
import {
  RenderCancelledError,
  RenderPipelineError,
  classifyRenderError,
  exhaustedFailure,
} from './render.errors';
import type { RenderAsset } from './render-graph';
import { renderTimeline } from './render-runner';

type PreparedCheckpoint = {
  audioByAssetId: Record<string, boolean>;
};

const CHECKPOINT_RANK: Record<RenderCheckpoint, number> = {
  none: 0,
  validated: 1,
  prepared: 2,
  rendered: 3,
};

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

function parsePreparedCheckpoint(value: Prisma.JsonValue | null): PreparedCheckpoint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const audioByAssetId = value.audioByAssetId;
  if (!audioByAssetId || typeof audioByAssetId !== 'object' || Array.isArray(audioByAssetId)) {
    return null;
  }
  const entries = Object.entries(audioByAssetId).filter(
    (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
  );
  return { audioByAssetId: Object.fromEntries(entries) };
}

@Processor(QueueNames.RENDER)
export class RenderProcessor extends WorkerHost {
  private readonly logger = new Logger(RenderProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  private async removeFileIfExists(filePath: string): Promise<void> {
    await fs.promises.rm(filePath, { force: true }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to remove export file ${filePath}: ${message}`);
    });
  }

  private async cleanupOldExports(userId: string, currentRenderJobId: string): Promise<void> {
    const oldJobs = await this.prisma.renderJob.findMany({
      where: {
        userId,
        id: { not: currentRenderJobId },
        outputPath: { not: null },
      },
      select: { id: true, outputPath: true },
    });

    await Promise.all(
      oldJobs
        .map((oldJob) => oldJob.outputPath)
        .filter((outputPath): outputPath is string => outputPath !== null)
        .map((outputPath) => this.removeFileIfExists(outputPath)),
    );

    if (oldJobs.length === 0) return;
    await this.prisma.renderJob.updateMany({
      where: { id: { in: oldJobs.map((oldJob) => oldJob.id) } },
      data: { outputUrl: null, outputPath: null },
    });
  }

  private async assertNotCancelled(renderJobId: string, stage: RenderStage): Promise<void> {
    const state = await this.prisma.renderJob.findUnique({
      where: { id: renderJobId },
      select: { cancelRequested: true, status: true },
    });
    if (
      !state ||
      state.cancelRequested ||
      state.status === 'cancelling' ||
      state.status === 'cancelled'
    ) {
      throw new RenderCancelledError(stage);
    }
  }

  private watchCancellation(renderJobId: string, controller: AbortController) {
    let checking = false;
    const timer = setInterval(() => {
      if (checking || controller.signal.aborted) return;
      checking = true;
      void this.prisma.renderJob
        .findUnique({ where: { id: renderJobId }, select: { cancelRequested: true } })
        .then((row) => {
          if (!row || row.cancelRequested) controller.abort();
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Unable to check cancellation for ${renderJobId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        })
        .finally(() => {
          checking = false;
        });
    }, RENDER_CANCEL_POLL_MS);
    return () => clearInterval(timer);
  }

  private async isCompleteVideo(filePath: string, fps: number): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size === 0) return false;
      const probe = await probeMedia(filePath, 'video/mp4', fps);
      return !!probe.width && !!probe.height && !!probe.durationInFrames;
    } catch {
      return false;
    }
  }

  @OnWorkerEvent('failed')
  async handleWorkerFailure(job: Job<RenderJobPayload> | undefined, error: Error): Promise<void> {
    if (!job) return;
    const allowedAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < allowedAttempts) return;

    const row = await this.prisma.renderJob.findUnique({ where: { id: job.data.renderJobId } });
    if (!row || ['completed', 'failed', 'cancelled'].includes(row.status)) return;
    const stage = row.stage as RenderStage;
    const failure = exhaustedFailure(
      classifyRenderError(
        new RenderPipelineError(
          'WORKER_ATTEMPTS_EXHAUSTED',
          'queue',
          stage,
          true,
          '导出 Worker 多次执行失败，任务已停止',
          error.message,
        ),
        stage,
      ),
    );
    await this.prisma.renderJob.update({
      where: { id: row.id },
      data: {
        status: 'failed',
        nextRetryAt: null,
        finishedAt: new Date(),
        ...failureColumns(failure),
      },
    });
  }

  async process(job: Job<RenderJobPayload>): Promise<unknown> {
    const { renderJobId, userId, projectId, quality } = job.data;
    const initial = await this.prisma.renderJob.findUnique({ where: { id: renderJobId } });
    if (!initial) throw new UnrecoverableError(`Render job ${renderJobId} no longer exists`);
    if (initial.status === 'completed' || initial.status === 'cancelled') {
      return { ok: initial.status === 'completed', outputUrl: initial.outputUrl };
    }

    let stage: RenderStage = 'validating';
    let outputPath = initial.outputPath;
    let checkpoint = initial.checkpoint as RenderCheckpoint;
    const attemptCount = initial.attemptCount + 1;
    const controller = new AbortController();
    const stopWatchingCancellation = this.watchCancellation(renderJobId, controller);

    const current = await this.prisma.renderJob.update({
      where: { id: renderJobId },
      data: {
        status: 'rendering',
        stage,
        attemptCount: { increment: 1 },
        startedAt: initial.startedAt ?? new Date(),
        finishedAt: null,
        nextRetryAt: null,
        error: null,
        errorDetail: null,
        failureCode: null,
        failureCategory: null,
        failureLevel: null,
        failureStage: null,
        retryable: false,
      },
    });

    this.logger.log(
      `Render job ${renderJobId} started (attempt ${attemptCount}/${current.maxAttempts}, checkpoint ${checkpoint})`,
    );

    try {
      await this.assertNotCancelled(renderJobId, stage);

      let timelineSource = current.timelineSnapshot;
      if (!timelineSource) {
        const project = await this.prisma.project.findFirst({
          where: { id: projectId, userId, deletedAt: null },
          select: { timeline: true },
        });
        if (!project) {
          throw new RenderPipelineError(
            'PROJECT_NOT_FOUND',
            'project',
            stage,
            false,
            '导出项目不存在或已被删除',
          );
        }
        timelineSource = project.timeline;
      }

      let timeline: Timeline;
      try {
        timeline = TimelineSchema.parse(timelineSource);
      } catch (error) {
        throw new RenderPipelineError(
          'TIMELINE_INVALID',
          'timeline',
          stage,
          false,
          '时间轴数据格式异常，请重新打开项目并检查轨道内容',
          error instanceof Error ? error.message : String(error),
        );
      }

      if (CHECKPOINT_RANK[checkpoint] < CHECKPOINT_RANK.validated) {
        checkpoint = 'validated';
        await this.prisma.renderJob.update({
          where: { id: renderJobId },
          data: { checkpoint, progress: 4 },
        });
      }
      await this.assertNotCancelled(renderJobId, stage);

      stage = 'preparing';
      await this.prisma.renderJob.update({
        where: { id: renderJobId },
        data: { stage, progress: Math.max(current.progress, 5) },
      });

      const assetIds = new Set<string>();
      timeline.tracks.forEach((track) => track.clips.forEach((clip) => assetIds.add(clip.assetId)));
      const rows = await this.prisma.asset.findMany({
        where: { userId, id: { in: [...assetIds] } },
      });
      const rowById = new Map(rows.map((row) => [row.id, row]));
      const missingIds = [...assetIds].filter((id) => !rowById.has(id));
      if (missingIds.length > 0) {
        throw new RenderPipelineError(
          'ASSET_RECORD_MISSING',
          'asset',
          stage,
          false,
          `时间轴引用的 ${missingIds.length} 个素材不存在，请删除或替换失效片段`,
          `Missing asset IDs: ${missingIds.join(', ')}`,
        );
      }

      const assetById = new Map<string, RenderAsset>();
      for (const assetId of assetIds) {
        const row = rowById.get(assetId)!;
        if (row.status !== 'ready') {
          const waiting = row.status === 'generating';
          throw new RenderPipelineError(
            waiting ? 'ASSET_NOT_READY' : 'ASSET_GENERATION_FAILED',
            'asset',
            stage,
            waiting,
            waiting
              ? `素材“${row.name}”仍在生成，系统将自动重试`
              : `素材“${row.name}”生成失败，请替换后重新导出`,
          );
        }
        if (!row.localPath) {
          throw new RenderPipelineError(
            'ASSET_PATH_MISSING',
            'asset',
            stage,
            false,
            `素材“${row.name}”缺少本地文件路径，请重新上传或生成该素材`,
          );
        }
        try {
          await fs.promises.access(row.localPath, fs.constants.R_OK);
        } catch (error) {
          throw new RenderPipelineError(
            'ASSET_FILE_UNREADABLE',
            'asset',
            stage,
            false,
            `素材“${row.name}”的源文件不存在或无法读取，请重新上传该素材`,
            error instanceof Error ? error.message : String(error),
          );
        }
        assetById.set(row.id, row as unknown as RenderAsset);
      }

      const cachedPreparation = parsePreparedCheckpoint(current.checkpointData);
      const canReusePreparation =
        CHECKPOINT_RANK[checkpoint] >= CHECKPOINT_RANK.prepared &&
        cachedPreparation &&
        rows
          .filter((row) => row.kind === 'video')
          .every((row) => row.id in cachedPreparation.audioByAssetId);

      let preparedCheckpoint: PreparedCheckpoint;
      if (canReusePreparation) {
        preparedCheckpoint = cachedPreparation;
      } else {
        const audioByAssetId: Record<string, boolean> = {};
        await Promise.all(
          rows
            .filter((row) => row.kind === 'video' && row.localPath)
            .map(async (row) => {
              const probe = await probeMedia(row.localPath!, 'video/mp4', timeline.settings.fps);
              audioByAssetId[row.id] = probe.audioCodec !== null;
            }),
        );
        preparedCheckpoint = { audioByAssetId };
        checkpoint = 'prepared';
        await this.prisma.renderJob.update({
          where: { id: renderJobId },
          data: {
            checkpoint,
            checkpointData: preparedCheckpoint as Prisma.InputJsonValue,
            progress: 9,
          },
        });
      }
      for (const [assetId, hasAudioStream] of Object.entries(preparedCheckpoint.audioByAssetId)) {
        const asset = assetById.get(assetId);
        if (asset) asset.hasAudioStream = hasAudioStream;
      }
      await this.assertNotCancelled(renderJobId, stage);

      const storageDir = path.resolve(this.config.get('STORAGE_DIR', { infer: true }));
      const exportDir = path.join(storageDir, 'users', userId, 'exports');
      await fs.promises.mkdir(exportDir, { recursive: true });
      outputPath = path.join(exportDir, `${renderJobId}.mp4`);
      await this.prisma.renderJob.update({
        where: { id: renderJobId },
        data: { outputPath },
      });

      const renderedFileIsComplete = await this.isCompleteVideo(outputPath, timeline.settings.fps);
      if (renderedFileIsComplete && CHECKPOINT_RANK[checkpoint] < CHECKPOINT_RANK.rendered) {
        checkpoint = 'rendered';
        await this.prisma.renderJob.update({
          where: { id: renderJobId },
          data: { checkpoint, progress: 97 },
        });
      }
      if (checkpoint === 'rendered' && !renderedFileIsComplete) {
        checkpoint = 'prepared';
        await this.prisma.renderJob.update({
          where: { id: renderJobId },
          data: { checkpoint },
        });
      }

      if (!renderedFileIsComplete || CHECKPOINT_RANK[checkpoint] < CHECKPOINT_RANK.rendered) {
        stage = 'rendering';
        checkpoint = 'prepared';
        await this.removeFileIfExists(outputPath);
        await this.prisma.renderJob.update({
          where: { id: renderJobId },
          data: { stage, checkpoint, progress: 10 },
        });
        let lastProgress = 9;
        await renderTimeline(
          timeline,
          assetById,
          outputPath,
          quality,
          (percent) => {
            const progress = Math.min(95, 10 + Math.round(percent * 0.85));
            if (progress <= lastProgress) return;
            lastProgress = progress;
            void job.updateProgress(progress);
            void this.prisma.renderJob
              .updateMany({
                where: { id: renderJobId, status: 'rendering' },
                data: { progress },
              })
              .catch(() => undefined);
          },
          controller.signal,
        );
        if (!(await this.isCompleteVideo(outputPath, timeline.settings.fps))) {
          throw new RenderPipelineError(
            'OUTPUT_VALIDATION_FAILED',
            'media',
            stage,
            true,
            'FFmpeg 已结束，但生成的视频文件不完整，系统将自动重试',
          );
        }
        checkpoint = 'rendered';
        await this.prisma.renderJob.update({
          where: { id: renderJobId },
          data: { checkpoint, progress: 97 },
        });
      }

      await this.assertNotCancelled(renderJobId, 'finalizing');
      stage = 'finalizing';
      await this.prisma.renderJob.update({
        where: { id: renderJobId },
        data: { stage, progress: 98 },
      });

      const publicUrl = this.config.get('PUBLIC_URL', { infer: true });
      const outputUrl = `${publicUrl}/files/users/${userId}/exports/${renderJobId}.mp4`;
      await this.cleanupOldExports(userId, renderJobId);
      await this.prisma.renderJob.update({
        where: { id: renderJobId },
        data: {
          status: 'completed',
          stage: 'completed',
          checkpoint: 'rendered',
          progress: 100,
          outputUrl,
          outputPath,
          error: null,
          errorDetail: null,
          failureCode: null,
          failureCategory: null,
          failureLevel: null,
          failureStage: null,
          retryable: false,
          cancelRequested: false,
          nextRetryAt: null,
          finishedAt: new Date(),
        },
      });
      await job.updateProgress(100);
      this.logger.log(`Render job ${renderJobId} completed: ${outputUrl}`);
      return { ok: true, outputUrl };
    } catch (error) {
      let failure = classifyRenderError(error, stage);
      const cancelled = failure.level === 'cancelled' || controller.signal.aborted;

      if (cancelled) {
        if (outputPath) await this.removeFileIfExists(outputPath);
        failure = classifyRenderError(new RenderCancelledError(stage), stage);
        await this.prisma.renderJob
          .update({
            where: { id: renderJobId },
            data: {
              status: 'cancelled',
              cancelRequested: true,
              nextRetryAt: null,
              finishedAt: new Date(),
              ...failureColumns(failure),
            },
          })
          .catch(() => undefined);
        this.logger.log(`Render job ${renderJobId} cancelled at stage ${stage}`);
        throw new UnrecoverableError(failure.message);
      }

      const hasAttemptsLeft = failure.retryable && attemptCount < current.maxAttempts;
      if (!hasAttemptsLeft) failure = exhaustedFailure(failure);
      if (stage === 'rendering' && checkpoint !== 'rendered' && outputPath) {
        await this.removeFileIfExists(outputPath);
      }
      const nextRetryAt = hasAttemptsLeft
        ? new Date(Date.now() + RENDER_RETRY_DELAY_MS * 2 ** Math.max(0, attemptCount - 1))
        : null;
      await this.prisma.renderJob
        .update({
          where: { id: renderJobId },
          data: {
            status: hasAttemptsLeft ? 'retrying' : 'failed',
            nextRetryAt,
            finishedAt: hasAttemptsLeft ? null : new Date(),
            ...failureColumns(failure),
          },
        })
        .catch(() => undefined);

      this.logger.error(
        `Render job ${renderJobId} failed at ${failure.stage} (${failure.code}), attempt ${attemptCount}/${current.maxAttempts}: ${failure.detail ?? failure.message}`,
      );
      if (!hasAttemptsLeft) throw new UnrecoverableError(`${failure.code}: ${failure.message}`);
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      stopWatchingCancellation();
    }
  }
}
