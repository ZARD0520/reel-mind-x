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
import { CreditsService } from '../credits/credits.service';

@Injectable()
export class CanvasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
  ) {}

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
        name: input.name?.trim() || '未命名',
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
    await this.prisma.$transaction(
      async (tx) => {
        const scope = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM canvases WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
        if (!scope.length) throw new NotFoundException(`Canvas ${id} not found`);
        const settlements = await this.credits.closeCanvasTasks(tx, id);
        await tx.canvas.delete({ where: { id } });
        // Take balance locks last, after scope/chat/asset locks, to avoid inversions with running workers.
        for (const hold of settlements) await this.credits.settle(tx, hold.id, hold.success);
      },
      { timeout: 30000 },
    );
  }
}
