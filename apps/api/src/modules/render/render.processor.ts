import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TimelineSchema, type Timeline } from '@reel/contracts';
import type { Job } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { probeMedia } from '../assets/media-probe';
import { QueueNames, type RenderJobPayload } from './render.constants';
import { renderTimeline } from './render-runner';
import type { RenderAsset } from './render-graph';

@Processor(QueueNames.RENDER)
export class RenderProcessor extends WorkerHost {
  private readonly logger = new Logger(RenderProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async process(job: Job<RenderJobPayload>): Promise<unknown> {
    const { renderJobId, userId, projectId, quality } = job.data;
    this.logger.log(`Render job ${renderJobId} (project ${projectId}) started`);

    try {
      await this.prisma.renderJob.update({
        where: { id: renderJobId },
        data: { status: 'rendering', progress: 0 },
      });

      const project = await this.prisma.project.findFirst({
        where: { id: projectId, userId, deletedAt: null },
      });
      if (!project) throw new Error(`Project ${projectId} not found`);
      const timeline: Timeline = TimelineSchema.parse(project.timeline);

      const ids = new Set<string>();
      timeline.tracks.forEach((track) => {
        track.clips.forEach((clip) => ids.add(clip.assetId));
      });
      const rows = await this.prisma.asset.findMany({ where: { userId, id: { in: [...ids] } } });
      const assetById = new Map<string, RenderAsset>();
      rows.forEach((row) => {
        assetById.set(row.id, row as unknown as RenderAsset);
      });

      await Promise.all(
        rows
          .filter((row) => row.kind === 'video' && row.localPath)
          .map(async (row) => {
            const probe = await probeMedia(row.localPath!, 'video/mp4', 30);
            const asset = assetById.get(row.id);
            if (asset) asset.hasAudioStream = probe.audioCodec !== null;
          }),
      );

      const storageDir = path.resolve(this.config.get('STORAGE_DIR', { infer: true }));
      const exportDir = path.join(storageDir, 'users', userId, 'exports');
      await fs.promises.mkdir(exportDir, { recursive: true });
      const fileName = `${renderJobId}.mp4`;
      const outputPath = path.join(exportDir, fileName);

      let lastPct = -1;
      await renderTimeline(timeline, assetById, outputPath, quality, (pct) => {
        if (pct !== lastPct) {
          lastPct = pct;
          void job.updateProgress(pct);
          void this.prisma.renderJob
            .update({ where: { id: renderJobId }, data: { progress: pct } })
            .catch(() => undefined);
        }
      });

      const publicUrl = this.config.get('PUBLIC_URL', { infer: true });
      const outputUrl = `${publicUrl}/files/users/${userId}/exports/${fileName}`;
      await this.prisma.renderJob.update({
        where: { id: renderJobId },
        data: { status: 'completed', progress: 100, outputUrl, outputPath, error: null },
      });
      this.logger.log(`Render job ${renderJobId} completed: ${outputUrl}`);
      return { ok: true, outputUrl };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Render job ${renderJobId} failed: ${message}`);
      await this.prisma.renderJob
        .update({ where: { id: renderJobId }, data: { status: 'failed', error: message } })
        .catch(() => undefined);
      throw err;
    }
  }
}
