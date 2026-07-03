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
    const { renderJobId, projectId, quality } = job.data;
    this.logger.log(`渲染任务 ${renderJobId} (project ${projectId}) 开始`);

    try {
      await this.prisma.renderJob.update({
        where: { id: renderJobId },
        data: { status: 'rendering', progress: 0 },
      });

      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!project) throw new Error(`Project ${projectId} not found`);
      const timeline: Timeline = TimelineSchema.parse(project.timeline);

      // 收集 timeline 引用到的素材（含 localPath）。
      const ids = new Set<string>();
      for (const t of timeline.tracks) for (const c of t.clips) ids.add(c.assetId);
      const rows = await this.prisma.asset.findMany({ where: { id: { in: [...ids] } } });
      const assetById = new Map<string, RenderAsset>();
      for (const r of rows) {
        assetById.set(r.id, r as unknown as RenderAsset);
      }

      // 探测视频是否含音频流：AI 生成的视频可能无声，若仍生成 [N:a] 滤镜会导致
      // "Stream specifier ':a' matches no streams"。图片/音频无需探测。
      await Promise.all(
        rows
          .filter((r) => r.kind === 'video' && r.localPath)
          .map(async (r) => {
            const probe = await probeMedia(r.localPath!, 'video/mp4', 30);
            const asset = assetById.get(r.id);
            if (asset) asset.hasAudioStream = probe.audioCodec !== null;
          }),
      );

      // 输出路径：STORAGE_DIR/EXPORT_SUBDIR/<jobId>.mp4
      const storageDir = path.resolve(this.config.get('STORAGE_DIR', { infer: true }));
      const subdir = this.config.get('EXPORT_SUBDIR', { infer: true });
      const exportDir = path.join(storageDir, subdir);
      await fs.promises.mkdir(exportDir, { recursive: true });
      const fileName = `${renderJobId}.mp4`;
      const outputPath = path.join(exportDir, fileName);

      // 进度回写节流：仅在百分比变化时写库。
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
      const outputUrl = `${publicUrl}/static/${subdir}/${fileName}`;
      await this.prisma.renderJob.update({
        where: { id: renderJobId },
        data: { status: 'completed', progress: 100, outputUrl, outputPath, error: null },
      });
      this.logger.log(`渲染任务 ${renderJobId} 完成 → ${outputUrl}`);
      return { ok: true, outputUrl };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`渲染任务 ${renderJobId} 失败: ${message}`);
      await this.prisma.renderJob
        .update({ where: { id: renderJobId }, data: { status: 'failed', error: message } })
        .catch(() => undefined);
      throw err;
    }
  }
}
