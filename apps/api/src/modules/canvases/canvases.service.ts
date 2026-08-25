import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CanvasGraphSchema,
  CanvasSchema,
  type Canvas,
  type CanvasGraph,
  type CreateCanvasInput,
  type UpdateCanvasInput,
} from '@reel/contracts';
import type { Prisma } from '@reel/db';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CanvasesService {
  constructor(private readonly prisma: PrismaService) {}

  private toInputJson(graph: CanvasGraph): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(graph)) as Prisma.InputJsonValue;
  }

  private toCanvas(row: {
    id: string;
    name: string;
    graph: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }): Canvas {
    return CanvasSchema.parse(row);
  }

  async create(userId: string, input: CreateCanvasInput): Promise<Canvas> {
    const row = await this.prisma.canvas.create({
      data: {
        userId,
        name: input.name?.trim() || '未命名工作流',
        graph: this.toInputJson(
          CanvasGraphSchema.parse({
            version: 1,
            nodes: [],
            edges: [],
            viewport: { x: 0, y: 0, zoom: 1 },
          }),
        ),
      },
    });
    return this.toCanvas(row);
  }

  async list(userId: string): Promise<Canvas[]> {
    const rows = await this.prisma.canvas.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => this.toCanvas(row));
  }

  async findOne(userId: string, id: string): Promise<Canvas> {
    const row = await this.prisma.canvas.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException(`Canvas ${id} not found`);
    return this.toCanvas(row);
  }

  async update(userId: string, id: string, input: UpdateCanvasInput): Promise<Canvas> {
    await this.findOne(userId, id);
    const row = await this.prisma.canvas.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.graph !== undefined ? { graph: this.toInputJson(input.graph) } : {}),
      },
    });
    return this.toCanvas(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.findOne(userId, id);
    await this.prisma.canvas.delete({ where: { id } });
  }
}
