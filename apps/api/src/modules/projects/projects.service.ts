import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ProjectSchema,
  TimelineSchema,
  type CreateProjectFromCanvasVideoInput,
  type CreateProjectInput,
  type Project,
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
    const timeline = input.timeline ?? TimelineSchema.parse({ settings: {} });
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
    await this.findOne(userId, id);
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
