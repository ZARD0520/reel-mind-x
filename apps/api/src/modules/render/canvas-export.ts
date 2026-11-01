import * as fs from 'fs/promises';
import * as path from 'path';
import { CanvasGraphSchema, type Timeline } from '@reel/contracts';
import type { Prisma } from '@reel/db';
import type { PrismaService } from '../../prisma/prisma.service';

/** The render snapshot owns the export destination, including across worker restarts. */
export async function finishRender(prisma: PrismaService, input: {
  id: string; userId: string; snapshot: unknown; timeline: Timeline;
  outputPath: string; outputUrl: string; fileName: string | null;
}) {
  const metadata = (input.snapshot as { canvasExport?: { canvasId: string; nodeId: string; assetId: string } })?.canvasExport;
  const completed = { status: 'completed', stage: 'completed', checkpoint: 'rendered', progress: 100, outputUrl: input.outputUrl, outputPath: input.outputPath, error: null, errorDetail: null, failureCode: null, failureCategory: null, failureLevel: null, failureStage: null, retryable: false, cancelRequested: false, nextRetryAt: null, finishedAt: new Date() };
  if (!metadata) return prisma.renderJob.update({ where: { id: input.id }, data: completed });
  // A canvas asset must outlive export-file cleanup for subsequent renders.
  const uploads = path.join(path.dirname(path.dirname(input.outputPath)), 'uploads');
  const filename = `${metadata.assetId}.mp4`;
  const localPath = path.join(uploads, filename);
  await fs.mkdir(uploads, { recursive: true });
  const temporary = `${localPath}.${input.id}.tmp`;
  await fs.copyFile(input.outputPath, temporary);
  await fs.rename(temporary, localPath);
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ graph: unknown }[]>`SELECT graph FROM canvases WHERE id = ${metadata.canvasId} AND "userId" = ${input.userId} FOR UPDATE`;
    if (!rows.length) throw new Error('来源画布已删除，无法导出到画布');
    const state = await tx.renderJob.findUnique({ where: { id: input.id } });
    if (!state || state.cancelRequested || state.status === 'cancelled') throw new Error('导出已取消');
    const graph = CanvasGraphSchema.parse(rows[0]!.graph);
    const url = `/files/users/${input.userId}/uploads/${filename}`;
    const totalFrames = Math.max(1, ...input.timeline.tracks.flatMap(track => [...track.clips, ...(track.textClips ?? [])].map(clip => clip.start + clip.durationInFrames)));
    await tx.asset.upsert({ where: { id: metadata.assetId }, update: {}, create: { id: metadata.assetId, userId: input.userId, canvasId: metadata.canvasId, kind: 'video', source: 'upload', status: 'ready', name: input.fileName ?? '剪辑成片.mp4', localPath, url, durationInFrames: Math.round(totalFrames * 30 / input.timeline.settings.fps), width: input.timeline.settings.width, height: input.timeline.settings.height, historyDeletedAt: new Date() } });
    if (!graph.nodes.some(node => node.id === metadata.nodeId)) {
      const source = graph.nodes.find(node => node.id === input.timeline.canvasSource?.nodeId);
      const position = { x: source ? source.position.x + 520 : (160 - graph.viewport.x) / graph.viewport.zoom, y: source?.position.y ?? (160 - graph.viewport.y) / graph.viewport.zoom };
      while (graph.nodes.some(node => Math.abs(node.position.x - position.x) < 450 && Math.abs(node.position.y - position.y) < 400)) position.y += 440;
      graph.nodes.push({ id: metadata.nodeId, type: 'workflow', position, data: { kind: 'video', title: input.fileName?.replace(/\.mp4$/i, '') || '剪辑成片', content: '', status: 'ready', uploaded: true, generationDetached: true, assetId: metadata.assetId, url } });
      await tx.canvas.update({ where: { id: metadata.canvasId }, data: { graph: graph as Prisma.InputJsonValue } });
    }
    return tx.renderJob.update({ where: { id: input.id }, data: completed });
  });
}
