import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetSchema, type Asset } from '@reel/contracts';
import * as fs from 'fs';
import * as path from 'path';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { probeMedia } from './media-probe';

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

    const row = await this.prisma.asset.create({
      data: {
        kind: probe.kind,
        source: 'upload',
        status: 'ready',
        name: name?.trim() || originalName,
        url: `${publicUrl}/static/uploads/${file.filename}`,
        localPath: path.resolve(file.path),
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
