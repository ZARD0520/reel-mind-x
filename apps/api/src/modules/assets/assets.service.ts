import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetSchema, type Asset } from '@reel/contracts';
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
  kind: string;
  source: string;
  status: string;
  name: string;
  url: string | null;
  durationInFrames: number | null;
  width: number | null;
  height: number | null;
  prompt: string | null;
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

  async createFromUpload(userId: string, file: Express.Multer.File, name?: string): Promise<Asset> {
    const probe = await probeMedia(file.path, file.mimetype, REFERENCE_FPS);
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
      },
    });
    return this.toAsset(row);
  }

  async findOne(userId: string, id: string): Promise<Asset> {
    const row = await this.prisma.asset.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException(`Asset ${id} not found`);
    return this.toAsset(row);
  }

  async list(userId: string): Promise<Asset[]> {
    const rows = await this.prisma.asset.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toAsset(row));
  }

  async remove(userId: string, id: string): Promise<void> {
    const row = await this.prisma.asset.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException(`Asset ${id} not found`);
    if (row.localPath) {
      await fs.promises.unlink(row.localPath).catch(() => undefined);
    }
    await this.prisma.asset.delete({ where: { id } });
  }
}
