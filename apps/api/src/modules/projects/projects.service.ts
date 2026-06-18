import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ProjectSchema,
  TimelineSchema,
  type CreateProjectInput,
  type Project,
  type UpdateProjectInput,
} from '@reel/contracts';
import type { Prisma } from '@reel/db';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  // Prisma 记录 → 校验后的 Project（timeline 是 jsonb，读出时用 schema 解析保证完整性）。
  private toProject(row: {
    id: string;
    name: string;
    timeline: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }): Project {
    return ProjectSchema.parse(row);
  }

  async create(input: CreateProjectInput): Promise<Project> {
    // 未提供 timeline 时落一份带默认 settings 的空时间轴。
    const timeline = input.timeline ?? TimelineSchema.parse({ settings: {} });
    const row = await this.prisma.project.create({
      data: { name: input.name, timeline: timeline as Prisma.InputJsonValue },
    });
    return this.toProject(row);
  }

  async findOne(id: string): Promise<Project> {
    const row = await this.prisma.project.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Project ${id} not found`);
    return this.toProject(row);
  }

  async list(): Promise<Project[]> {
    const rows = await this.prisma.project.findMany({ orderBy: { updatedAt: 'desc' } });
    return rows.map((row) => this.toProject(row));
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project> {
    await this.findOne(id); // 不存在则 404
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

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.project.delete({ where: { id } });
  }
}
