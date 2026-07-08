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
    const row = await this.prisma.project.create({
      data: { userId, name: input.name, timeline: timeline as Prisma.InputJsonValue },
    });
    return this.toProject(row);
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
