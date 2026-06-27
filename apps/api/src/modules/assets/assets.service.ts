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

// MVP：素材时长按参考 fps 折算成帧（项目默认 fps 也是 30）。
// 多 fps 场景下需改为存秒/源时长，见 DECISIONS D14 备注。
const REFERENCE_FPS = 30;

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

  // Prisma 行 → 对外 Asset（剔除 localPath，前端只拿 url）。
  private toAsset(row: AssetRow): Asset {
    return AssetSchema.parse(row);
  }

  async createFromUpload(file: Express.Multer.File, name?: string): Promise<Asset> {
    const probe = await probeMedia(file.path, file.mimetype, REFERENCE_FPS);
    const publicUrl = this.config.get('PUBLIC_URL', { infer: true });
    // multer 以 latin1 解析 originalname，转回 UTF-8 以正确显示中文文件名。
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

    // 浏览器不支持的编码（如 ALAC、HEVC、ProRes）转码成 Web 兼容格式（AAC / H.264），
    // 否则预览的 <audio>/<video> 无法解码（静默失败，error.code=4）。导出本就重编码，无损画质不受影响。
    let storedFilename = file.filename;
    let storedPath = path.resolve(file.path);
    if (needsTranscode(probe)) {
      const ext = probe.kind === 'audio' ? 'm4a' : 'mp4';
      const webFilename = `${randomUUID()}.${ext}`;
      const webPath = path.join(path.dirname(file.path), webFilename);
      try {
        await transcodeForWeb(file.path, webPath, probe);
        // 转码成功：用 Web 版替换原文件（删原始，预览/导出都用 Web 版）。
        await fs.promises.unlink(file.path).catch(() => undefined);
        storedFilename = webFilename;
        storedPath = path.resolve(webPath);
      } catch (err) {
        // 转码失败：保留原文件（导出仍可用 FFmpeg 解码），预览可能无声但不阻断上传。
        console.warn(`[Assets] 转码失败，保留原文件: ${(err as Error).message}`);
      }
    }

    const row = await this.prisma.asset.create({
      data: {
        kind: probe.kind,
        source: 'upload',
        status: 'ready',
        name: name?.trim() || originalName,
        url: `${publicUrl}/static/uploads/${storedFilename}`,
        localPath: storedPath,
        durationInFrames: probe.durationInFrames,
        width: probe.width,
        height: probe.height,
        prompt: null,
      },
    });
    return this.toAsset(row);
  }

  async findOne(id: string): Promise<Asset> {
    const row = await this.prisma.asset.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Asset ${id} not found`);
    return this.toAsset(row);
  }

  async list(): Promise<Asset[]> {
    const rows = await this.prisma.asset.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((row) => this.toAsset(row));
  }

  async remove(id: string): Promise<void> {
    const row = await this.prisma.asset.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Asset ${id} not found`);
    // 先删本机文件（失败不阻断删记录），再删 DB 记录。
    if (row.localPath) {
      await fs.promises.unlink(row.localPath).catch(() => undefined);
    }
    await this.prisma.asset.delete({ where: { id } });
  }
}
