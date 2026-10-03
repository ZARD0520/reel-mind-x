import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AssetFolderSchema,
  AssetLibrarySearchResultSchema,
  AssetSchema,
  type Asset,
  type AssetFolder,
  type AssetFolderScope,
  type AssetLibrarySearchResult,
  type CreateAssetFolderInput,
  type UpdateAssetFolderInput,
} from '@reel/contracts';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AssetFoldersService {
  constructor(private readonly prisma: PrismaService) {}

  private toFolder(row: {
    id: string;
    userId: string;
    parentId: string | null;
    teamId: string | null;
    name: string;
    createdAt: Date;
    updatedAt: Date;
  }): AssetFolder {
    return AssetFolderSchema.parse(row);
  }

  private toAsset(row: {
    id: string;
    projectId: string | null;
    canvasId: string | null;
    folderId: string | null;
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
  }): Asset {
    return AssetSchema.parse(row);
  }

  async list(userId: string, scope: AssetFolderScope): Promise<AssetFolder[]> {
    if (scope === 'team') {
      // 团队素材库：团队功能上线后改为按用户所在团队查询（teamId in memberTeamIds）
      return [];
    }
    const rows = await this.prisma.assetFolder.findMany({
      where: { userId, teamId: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toFolder(row));
  }

  async create(userId: string, input: CreateAssetFolderInput): Promise<AssetFolder> {
    if (input.scope === 'team') {
      // 团队功能上线后：校验 teamId 归属 + 用户是否为团队成员，然后带 teamId 落库
      throw new BadRequestException('团队功能尚未开放，暂不支持创建团队文件夹');
    }
    // 嵌套创建：父文件夹必须存在且属于当前用户的个人素材库
    if (input.parentId) {
      const parent = await this.prisma.assetFolder.findFirst({
        where: { id: input.parentId, userId, teamId: null },
        select: { id: true },
      });
      if (!parent) throw new BadRequestException('父文件夹不存在');
    }
    const row = await this.prisma.assetFolder.create({
      data: { userId, teamId: null, parentId: input.parentId ?? null, name: input.name },
    });
    return this.toFolder(row);
  }

  async update(userId: string, id: string, input: UpdateAssetFolderInput): Promise<AssetFolder> {
    const row = await this.findOwnedRow(userId, id);
    const updated = await this.prisma.assetFolder.update({
      where: { id: row.id },
      data: { name: input.name },
    });
    return this.toFolder(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    const row = await this.findOwnedRow(userId, id);
    // 子文件夹与其中素材由数据库级联删除
    await this.prisma.assetFolder.delete({ where: { id: row.id } });
  }

  /** 文件夹内的素材内容（仅当前层级，不含子文件夹） */
  async listAssets(userId: string, id: string): Promise<Asset[]> {
    await this.findOwnedRow(userId, id);
    const rows = await this.prisma.asset.findMany({
      where: { userId, folderId: id },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toAsset(row));
  }

  /** 素材库搜索：按素材名称模糊匹配个人素材库中的素材，并附带所在文件夹路径 */
  async searchAssets(userId: string, q: string): Promise<AssetLibrarySearchResult[]> {
    const rows = await this.prisma.asset.findMany({
      where: {
        userId,
        folderId: { not: null },
        name: { contains: q, mode: 'insensitive' as const },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const folders = await this.prisma.assetFolder.findMany({
      where: { userId, teamId: null },
      select: { id: true, parentId: true, name: true },
    });
    const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
    const pathFor = (folderId: string) => {
      const chain: { id: string; name: string }[] = [];
      const visited = new Set<string>();
      let cursor = folderMap.get(folderId);
      while (cursor && !visited.has(cursor.id)) {
        visited.add(cursor.id);
        chain.unshift({ id: cursor.id, name: cursor.name });
        cursor = cursor.parentId ? folderMap.get(cursor.parentId) : undefined;
      }
      return chain;
    };
    return rows.map((row) =>
      AssetLibrarySearchResultSchema.parse({
        ...this.toAsset(row),
        folderPath: pathFor(row.folderId!),
      }),
    );
  }

  // 团队文件夹的成员归属校验待团队功能上线后补充，现阶段只放行个人文件夹
  private async findOwnedRow(userId: string, id: string) {
    const row = await this.prisma.assetFolder.findFirst({ where: { id, userId, teamId: null } });
    if (!row) throw new NotFoundException(`AssetFolder ${id} not found`);
    return row;
  }
}
