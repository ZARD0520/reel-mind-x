import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ProjectSchema,
  CanvasGraphSchema,
  TimelineSchema,
  type CreateProjectFromCanvasVideoInput,
  type CreateProjectInput,
  type Project,
  type OpenCanvasEditInput,
  type UpdateProjectInput,
} from '@reel/contracts';
import type { Prisma } from '@reel/db';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ProjectsService {
  private readonly maxActiveProjects = 3;

  constructor(private readonly prisma: PrismaService) {}

  private toProject(row: {
    id: string;
    name: string;
    timeline: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }): Project {
    return ProjectSchema.parse(row);
  }

  async create(userId: string, input: CreateProjectInput): Promise<Project> {
    const timeline = TimelineSchema.parse(input.timeline ?? { settings: {} });
    delete timeline.canvasSource;
    const row = await this.prisma.$transaction(async (tx) => {
      const activeProjectCount = await tx.project.count({ where: { userId, deletedAt: null } });
      if (activeProjectCount >= this.maxActiveProjects) {
        throw new ConflictException('每个用户最多只能创建 3 个剪辑');
      }
      return tx.project.create({
        data: { userId, name: input.name, timeline: timeline as Prisma.InputJsonValue },
      });
    });
    return this.toProject(row);
  }

  async createFromCanvasVideo(
    userId: string,
    input: CreateProjectFromCanvasVideoInput,
  ): Promise<Project> {
    const source = await this.prisma.asset.findFirst({
      where: {
        id: input.assetId,
        userId,
        canvasId: { not: null },
        kind: 'video',
        status: 'ready',
      },
    });
    if (!source) throw new NotFoundException('画布视频不存在或尚未生成完成');
    if (!source.localPath) throw new BadRequestException('画布视频文件不可用，请重新生成');
    const activeProjectCount = await this.prisma.project.count({
      where: { userId, deletedAt: null },
    });
    if (activeProjectCount >= this.maxActiveProjects) {
      throw new ConflictException('每个用户最多只能创建 3 个剪辑');
    }

    const projectId = randomUUID();
    const assetId = randomUUID();
    const extension = path.extname(source.localPath) || '.mp4';
    const filename = `${randomUUID()}${extension}`;
    const localPath = path.join(path.dirname(source.localPath), filename);
    const url = `/files/users/${userId}/uploads/${filename}`;
    const durationInFrames = Math.max(1, source.durationInFrames ?? 150);
    const name = (input.name?.trim() || `${source.name} 剪辑`).slice(0, 200);
    const timeline = TimelineSchema.parse({
      settings: {
        fps: 30,
        width: source.width ?? 1920,
        height: source.height ?? 1080,
      },
      tracks: [
        {
          id: randomUUID(),
          kind: 'video',
          clips: [
            {
              id: randomUUID(),
              assetId,
              start: 0,
              durationInFrames,
              trimStart: 0,
              transform: {},
              transitionOut: null,
            },
          ],
        },
      ],
    });

    await fs.promises.copyFile(source.localPath, localPath).catch(() => {
      throw new BadRequestException('复制画布视频失败，请稍后重试');
    });

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const activeProjectCount = await tx.project.count({ where: { userId, deletedAt: null } });
        if (activeProjectCount >= this.maxActiveProjects) {
          throw new ConflictException('每个用户最多只能创建 3 个剪辑');
        }
        const project = await tx.project.create({
          data: {
            id: projectId,
            userId,
            name,
            timeline: timeline as Prisma.InputJsonValue,
          },
        });
        await tx.asset.create({
          data: {
            id: assetId,
            userId,
            projectId,
            kind: 'video',
            source: source.source,
            status: 'ready',
            name: source.name,
            url,
            localPath,
            durationInFrames: source.durationInFrames,
            width: source.width,
            height: source.height,
            prompt: source.prompt,
          },
        });
        return project;
      });
      return this.toProject(row);
    } catch (error) {
      await fs.promises.unlink(localPath).catch(() => undefined);
      throw error;
    }
  }

  async openCanvasEdit(userId: string, input: OpenCanvasEditInput): Promise<Project> {
    const copied: string[] = [];
    try {
      const row = await this.prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<{ graph: Prisma.JsonValue }[]>`SELECT graph FROM canvases WHERE id = ${input.canvasId} AND "userId" = ${userId} FOR UPDATE`;
        if (!rows.length) throw new NotFoundException('画布不存在');
        const graph = CanvasGraphSchema.parse(rows[0]!.graph);
        const node = graph.nodes.find(item => item.id === input.nodeId && item.data.kind === 'edit');
        if (!node) throw new NotFoundException('智能剪辑节点不存在');
        const dependencies = graph.edges.filter(edge => edge.target === node.id).map(edge => graph.nodes.find(item => item.id === edge.source));
        if (!dependencies.length) throw new BadRequestException('请先引用图片、视频或音频节点');
        if (dependencies.some(item => !item || !['image', 'video', 'audio'].includes(String(item.data.kind)) || item.data.status !== 'ready' || !item.data.assetId)) {
          throw new BadRequestException('引用的素材尚未就绪，请等待生成或上传完成');
        }
        const sourceIds = [...new Set(dependencies.map(item => String(item!.data.assetId)))];
        const sources = await tx.asset.findMany({ where: { id: { in: sourceIds }, userId, status: 'ready', kind: { in: ['image', 'video', 'audio'] } } });
        if (sources.length !== sourceIds.length) throw new BadRequestException('引用素材不可用，请重新选择');
        const existing = typeof node.data.editorProjectId === 'string'
          ? await tx.project.findFirst({ where: { id: node.data.editorProjectId, userId, deletedAt: null } }) : null;
        const previous = existing ? TimelineSchema.parse(existing.timeline) : null;
        if (existing && (previous?.canvasSource?.canvasId !== input.canvasId || previous.canvasSource.nodeId !== node.id)) throw new BadRequestException('剪辑项目不属于当前节点');
        if (!existing && await tx.project.count({ where: { userId, deletedAt: null } }) >= this.maxActiveProjects) throw new ConflictException('每个用户最多只能创建 3 个剪辑');
        const projectId = existing?.id ?? randomUUID();
        const imported = await tx.asset.findMany({ where: { userId, projectId } });
        const mapping: { sourceAssetId: string; assetId: string }[] = [];
        const additions: Prisma.AssetUncheckedCreateInput[] = [];
        for (const sourceId of sourceIds) {
          const source = sources.find(asset => asset.id === sourceId)!;
          const old = previous?.canvasSource?.assets.find(item => item.sourceAssetId === sourceId);
          if (old && imported.some(asset => asset.id === old.assetId)) { mapping.push(old); continue; }
          const sourceFile = source.localPath ?? (source.url ? (await tx.asset.findFirst({ where: { userId, url: source.url, localPath: { not: null }, status: 'ready' } }))?.localPath : null);
          if (!sourceFile) throw new BadRequestException('引用素材文件不可用');
          const assetId = randomUUID();
          const filename = `${randomUUID()}${path.extname(sourceFile)}`;
          const localPath = path.join(path.dirname(sourceFile), filename);
          await fs.promises.copyFile(sourceFile, localPath).catch(() => { throw new BadRequestException('复制引用素材失败，请检查素材文件后重试'); });
          copied.push(localPath);
          mapping.push({ sourceAssetId: sourceId, assetId });
          additions.push({ id: assetId, userId, projectId, kind: source.kind, source: source.source, status: 'ready', name: source.name, url: `/files/users/${userId}/${path.basename(path.dirname(sourceFile))}/${filename}`, localPath, durationInFrames: source.durationInFrames, width: source.width, height: source.height, prompt: source.prompt, model: source.model, references: source.references as Prisma.InputJsonValue });
        }
        const allowed = new Set(mapping.map(item => item.assetId));
        const firstVisual = sources.find(asset => asset.kind !== 'audio');
        const timeline = previous ?? TimelineSchema.parse({ settings: { width: firstVisual?.width ?? 1920, height: firstVisual?.height ?? 1080 } });
        timeline.canvasSource = { canvasId: input.canvasId, nodeId: node.id, assets: mapping };
        if (!previous) {
          let cursor = 0;
          const visual = { id: randomUUID(), kind: 'video' as const, clips: [] as import('@reel/contracts').Clip[] };
          for (const sourceId of sourceIds) {
            const source = sources.find(asset => asset.id === sourceId)!;
            const duration = Math.max(1, source.durationInFrames ?? 90);
            const clip = { id: randomUUID(), assetId: mapping.find(item => item.sourceAssetId === sourceId)!.assetId, start: source.kind === 'audio' ? 0 : cursor, durationInFrames: duration, trimStart: 0, transform: {}, transitionOut: null };
            const parsed = TimelineSchema.parse({ settings: {}, tracks: [{ id: randomUUID(), kind: source.kind === 'audio' ? 'audio' : 'video', clips: [clip] }] }).tracks[0]!;
            if (source.kind === 'audio') timeline.tracks.push(parsed);
            else { visual.clips.push(...parsed.clips); cursor += duration; }
          }
          if (visual.clips.length) timeline.tracks.unshift({ ...visual, muted: false, hidden: false });
        } else {
          // Preserve manual edits; disconnected dependencies are removed from the composition.
          timeline.tracks = timeline.tracks.map(track => ({ ...track, clips: track.clips.filter(clip => allowed.has(clip.assetId)) }));
        }
        const data = { timeline: timeline as unknown as Prisma.InputJsonValue };
        const project = existing ? await tx.project.update({ where: { id: projectId }, data })
          : await tx.project.create({ data: { ...data, id: projectId, userId, name: String(node.data.title || '智能剪辑').slice(0, 200) } });
        if (additions.length) await tx.asset.createMany({ data: additions });
        // Keep historical asset records for in-flight renders; the library only exposes the current source allowlist.
        node.data.editorProjectId = projectId;
        await tx.canvas.update({ where: { id: input.canvasId }, data: { graph: graph as unknown as Prisma.InputJsonValue } });
        return project;
      }, { timeout: 30000 });
      return this.toProject(row);
    } catch (error) {
      await Promise.all(copied.map(file => fs.promises.unlink(file).catch(() => undefined)));
      throw error;
    }
  }

  async findOne(userId: string, id: string): Promise<Project> {
    const row = await this.prisma.project.findFirst({ where: { id, userId, deletedAt: null } });
    if (!row) throw new NotFoundException(`Project ${id} not found`);
    return this.toProject(row);
  }

  async list(userId: string): Promise<Project[]> {
    const rows = await this.prisma.project.findMany({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => this.toProject(row));
  }

  async update(userId: string, id: string, input: UpdateProjectInput): Promise<Project> {
    const existing = await this.findOne(userId, id);
    if (input.timeline && existing.timeline.canvasSource) {
      const allowed = new Set(existing.timeline.canvasSource.assets.map(item => item.assetId));
      if (input.timeline.tracks.some(track => track.clips.some(clip => !allowed.has(clip.assetId)))) throw new BadRequestException('智能剪辑只能使用节点引用的素材');
      input.timeline.canvasSource = existing.timeline.canvasSource;
    } else if (input.timeline) delete input.timeline.canvasSource;
    const row = await this.prisma.project.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.timeline !== undefined
          ? { timeline: input.timeline as Prisma.InputJsonValue }
          : {}),
      },
    });
    return this.toProject(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.findOne(userId, id);
    await this.prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
