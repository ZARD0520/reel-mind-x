import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AssetSchema,
  type Asset,
  type AssetHistoryQueryInput,
  type SaveAssetToLibraryInput,
  type UpdateAssetInput,
} from '@reel/contracts';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { probeMedia } from './media-probe';
import { needsTranscode, transcodeForWeb } from './transcode';

const REFERENCE_FPS = 30;

function userUploadUrl(userId: string, filename: string): string {
  return `/files/users/${userId}/uploads/${filename}`;
}

type AssetRow = {
  id: string;
  projectId: string | null;
  canvasId: string | null;
  folderId: string | null;
  kind: string;
  source: string;
  status: string;
  name: string;
  url: string | null;
  content: string | null;
  durationInFrames: number | null;
  width: number | null;
  height: number | null;
  prompt: string | null;
  model?: string | null;
  createdAt: Date;
};

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private toAsset(row: AssetRow): Asset {
    return AssetSchema.parse(row);
  }

  async createFromUpload(
    userId: string,
    projectId: string,
    file: Express.Multer.File,
    name?: string,
  ): Promise<Asset> {
    await this.assertProjectOwned(userId, projectId);
    return this.storeUpload(userId, { projectId }, file, name);
  }

  async createFromCanvasUpload(userId: string, canvasId: string, kind: 'image' | 'video' | 'audio', file: Express.Multer.File): Promise<Asset> {
    try {
      const canvas = await this.prisma.canvas.findFirst({ where: { id: canvasId, userId }, select: { id: true } });
      if (!canvas) throw new NotFoundException('Canvas not found');
      if (file.size > 500 * 1024 * 1024) throw new BadRequestException('文件大小不能超过 500MB');
      if (!file.mimetype.startsWith(`${kind}/`)) throw new BadRequestException('上传素材类型与节点不匹配');
      return await this.storeUpload(userId, { canvasId }, file, undefined, kind);
    } catch (error) {
      await fs.promises.unlink(file.path).catch(() => undefined);
      throw error;
    }
  }

  private async storeUpload(userId: string, scope: { projectId?: string; canvasId?: string }, file: Express.Multer.File, name?: string, expectedKind?: 'image' | 'video' | 'audio'): Promise<Asset> {

    const probe = await probeMedia(file.path, file.mimetype, REFERENCE_FPS);
    if (expectedKind && probe.kind !== expectedKind) throw new BadRequestException('上传素材类型与节点不匹配');
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

    let storedFilename = file.filename;
    let storedPath = path.resolve(file.path);
    if (needsTranscode(probe)) {
      const ext = probe.kind === 'audio' ? 'm4a' : 'mp4';
      const webFilename = `${randomUUID()}.${ext}`;
      const webPath = path.join(path.dirname(file.path), webFilename);
      try {
        await transcodeForWeb(file.path, webPath, probe);
        await fs.promises.unlink(file.path).catch(() => undefined);
        storedFilename = webFilename;
        storedPath = path.resolve(webPath);
      } catch (err) {
        console.warn(`[Assets] Transcode failed, keeping original: ${(err as Error).message}`);
      }
    }

    const row = await this.prisma.asset.create({
      data: {
        userId,
        ...scope,
        kind: probe.kind,
        source: 'upload',
        status: 'ready',
        name: name?.trim() || originalName,
        url: userUploadUrl(userId, storedFilename),
        localPath: storedPath,
        durationInFrames: probe.durationInFrames,
        width: probe.width,
        height: probe.height,
        prompt: null,
        // Canvas uploads are node content, not generation/material history.
        ...(scope.canvasId ? { historyDeletedAt: new Date() } : {}),
      },
    });
    return this.toAsset(row);
  }

  private async assertProjectOwned(userId: string, projectId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);
  }

  async findOne(userId: string, id: string): Promise<Asset> {
    const row = await this.prisma.asset.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException(`Asset ${id} not found`);
    return this.toAsset(row);
  }

  async list(userId: string, projectId: string): Promise<Asset[]> {
    const rows = await this.prisma.asset.findMany({
      where: { userId, projectId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toAsset(row));
  }

  /** 历史包括原始生成、上传素材，不包括保存到资产库的独立副本。 */
  async history(userId: string, query: AssetHistoryQueryInput): Promise<Asset[]> {
    const rows = await this.prisma.asset.findMany({
      where: {
        userId,
        source: { in: ['ai', 'upload'] },
        status: 'ready',
        folderId: null,
        historyDeletedAt: null,
        ...(query.scope === 'canvas' && query.canvasId ? { canvasId: query.canvasId } : {}),
        ...(query.q ? { OR: [{ prompt: { contains: query.q, mode: 'insensitive' as const } }, { name: { contains: query.q, mode: 'insensitive' as const } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((row) => this.toAsset(row));
  }

  async removeHistory(userId: string, id: string): Promise<void> {
    const result = await this.prisma.asset.updateMany({
      where: { id, userId, source: { in: ['ai', 'upload'] }, status: 'ready', folderId: null },
      data: { historyDeletedAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException(`Asset history ${id} not found`);
  }

  async remove(userId: string, id: string): Promise<void> {
    const row = await this.prisma.asset.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException(`Asset ${id} not found`);
    const generation = await this.prisma.generationTaskItem.findUnique({ where: { assetId: id }, select: { status: true, providerResult: true } });
    if (generation && ((generation.status !== 'completed' && generation.status !== 'failed') || (generation.status === 'failed' && generation.providerResult))) {
      throw new ConflictException('该素材的生成任务尚未结束或仍可恢复，暂时无法删除');
    }
    if (row.localPath) {
      await fs.promises.unlink(row.localPath).catch(() => undefined);
    }
    await this.prisma.asset.delete({ where: { id } });
  }

  /**
   * 保存素材到资产库：复制一条独立的资产库记录指向同一文件，不是新的生成记录。
   * 不复制 localPath（文件清理仍由原素材记录负责）。
   */
  async saveToLibrary(
    userId: string,
    id: string,
    input: SaveAssetToLibraryInput,
  ): Promise<Asset> {
    const asset = await this.prisma.asset.findFirst({ where: { id, userId } });
    if (!asset) throw new NotFoundException(`Asset ${id} not found`);
    if (asset.folderId) throw new BadRequestException('该素材已在资产库中');

    const folder = await this.prisma.assetFolder.findFirst({
      where: { id: input.folderId, userId, teamId: null },
    });
    if (!folder) throw new NotFoundException(`AssetFolder ${input.folderId} not found`);

    const row = await this.prisma.asset.create({
      data: {
        userId,
        projectId: null,
        canvasId: null,
        folderId: folder.id,
        kind: asset.kind,
        source: asset.source,
        status: 'ready',
        // 素材库名称默认取保存时的展示名（如画布节点名），未传则沿用原素材名
        name: input.name?.trim() || asset.name,
        url: asset.url,
        localPath: null,
        durationInFrames: asset.durationInFrames,
        width: asset.width,
        height: asset.height,
        prompt: asset.prompt,
        model: asset.model,
        references: asset.references ?? [],
      },
    });
    return this.toAsset(row);
  }

  async update(userId: string, id: string, input: UpdateAssetInput): Promise<Asset> {
    const row = await this.prisma.asset.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException(`Asset ${id} not found`);
    const updated = await this.prisma.asset.update({
      where: { id },
      data: { name: input.name },
    });
    return this.toAsset(updated);
  }
}
