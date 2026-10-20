import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdjustCreditsSchema,
  CreditPriceInputSchema,
  PageQuerySchema,
  PlatformSettingsSchema,
} from '@reel/contracts';
import { Prisma } from '@reel/db';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { CreditsService } from '../credits/credits.service';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
  ) {}

  async overview() {
    const [users, tasks, completed, failed, totals, groups, spending] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.generationTask.count(),
      this.prisma.generationTask.count({ where: { status: 'completed' } }),
      this.prisma.generationTask.count({ where: { status: 'failed' } }),
      this.prisma.creditAccount.aggregate({ _sum: { available: true, frozen: true, spent: true } }),
      this.prisma.generationTask.groupBy({ by: ['kind', 'model', 'status'], _count: true }),
      this.prisma.$queryRaw<
        { kind: string; model: string; spent: number }[]
      >`SELECT t.kind, t.model, SUM(h.amount)::float8 AS spent
        FROM generation_task_items i JOIN generation_tasks t ON t.id = i."taskId"
        JOIN credit_holds h ON h.id = i."creditHoldId" WHERE h.status = 'captured' GROUP BY t.kind, t.model`,
    ]);
    const models = new Map<
      string,
      {
        kind: string;
        model: string;
        tasks: number;
        completed: number;
        failed: number;
        spent: number;
      }
    >();
    for (const group of groups) {
      const key = `${group.kind}/${group.model}`;
      const row = models.get(key) ?? {
        kind: group.kind,
        model: group.model,
        tasks: 0,
        completed: 0,
        failed: 0,
        spent:
          spending.find((value) => value.kind === group.kind && value.model === group.model)
            ?.spent ?? 0,
      };
      row.tasks += group._count;
      if (group.status === 'completed') row.completed += group._count;
      if (group.status === 'failed') row.failed += group._count;
      models.set(key, row);
    }
    return {
      users,
      tasks,
      completed,
      failed,
      active: tasks - completed - failed,
      available: totals._sum.available ?? 0,
      frozen: totals._sum.frozen ?? 0,
      spent: totals._sum.spent ?? 0,
      models: [...models.values()],
    };
  }

  async users(raw: unknown) {
    const { page, pageSize, search } = PageQuerySchema.parse(raw);
    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          role: true,
          createdAt: true,
          creditAccount: { select: { available: true, frozen: true, spent: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async updateUser(actorId: string, id: string, raw: unknown) {
    const { status } = z.object({ status: z.enum(['active', 'disabled']) }).parse(raw);
    if (actorId === id && status === 'disabled')
      throw new BadRequestException('不能禁用自己的账号');
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('用户不存在');
      if (before.role === 'admin')
        throw new BadRequestException('请通过数据库管理命令管理管理员账号');
      await tx.user.update({ where: { id }, data: { status } });
      await tx.adminAudit.create({
        data: {
          actorId,
          action: 'user.status',
          targetId: id,
          detail: { before: before.status, after: status },
        },
      });
      return { status };
    });
  }

  async adjust(actorId: string, userId: string, raw: unknown) {
    const input = AdjustCreditsSchema.parse(raw);
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.user.findUnique({ where: { id: userId } })))
        throw new NotFoundException('用户不存在');
      const account = await this.credits.account(tx, userId);
      const key = `adjust:${actorId}:${input.requestId}`;
      const existing = await tx.creditEntry.findUnique({ where: { key } });
      if (existing) {
        if (
          existing.userId !== userId ||
          existing.amount !== input.amount ||
          existing.reason !== input.reason
        )
          throw new ConflictException('同一请求不能重复用于不同的调整');
        return account;
      }
      if (account.available + input.amount < 0)
        throw new BadRequestException('扣减金额超过可用积分，不能扣减冻结积分');
      if (account.available + input.amount > 1000000000)
        throw new BadRequestException('余额超过账户上限');
      const updated = await tx.creditAccount.update({
        where: { userId },
        data: { available: { increment: input.amount } },
      });
      await tx.creditEntry.create({
        data: {
          userId,
          key,
          type: 'adjustment',
          amount: input.amount,
          availableDelta: input.amount,
          frozenDelta: 0,
          availableAfter: updated.available,
          frozenAfter: updated.frozen,
          reason: input.reason,
          actorId,
        },
      });
      await tx.adminAudit.create({
        data: { actorId, action: 'credits.adjust', targetId: userId, detail: input },
      });
      return updated;
    });
  }

  async ledger(raw: unknown) {
    const { page, pageSize, userId, search } = PageQuerySchema.parse(raw);
    const where: Prisma.CreditEntryWhereInput = {
      ...(userId ? { userId } : {}),
      ...(search ? { referenceId: search } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.creditEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.creditEntry.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async tasks(raw: unknown) {
    const { page, pageSize, userId, status, search } = PageQuerySchema.parse(raw);
    const where: Prisma.GenerationTaskWhereInput = {
      ...(userId ? { userId } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { id: search },
              { model: { contains: search, mode: 'insensitive' } },
              { user: { email: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.generationTask.findMany({
        where,
        select: {
          id: true,
          userId: true,
          kind: true,
          model: true,
          status: true,
          creditQuote: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
          items: {
            orderBy: { index: 'asc' },
            select: {
              id: true,
              status: true,
              error: true,
              creditCost: true,
              creditHoldId: true,
              providerTaskId: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.generationTask.count({ where }),
    ]);
    const holds = await this.prisma.creditHold.findMany({
      where: {
        id: {
          in: rows.flatMap((row) =>
            row.items.flatMap((item) => (item.creditHoldId ? [item.creditHoldId] : [])),
          ),
        },
      },
      select: { id: true, status: true, amount: true },
    });
    return {
      items: rows.map((row) => ({
        ...row,
        settlements: holds.filter((hold) =>
          row.items.some((item) => item.creditHoldId === hold.id),
        ),
      })),
      total,
      page,
      pageSize,
    };
  }

  prices() {
    return this.prisma.creditPrice.findMany({ orderBy: [{ kind: 'asc' }, { model: 'asc' }] });
  }
  async savePrice(actorId: string, raw: unknown) {
    const input = CreditPriceInputSchema.parse(raw);
    return this.prisma.$transaction(async (tx) => {
      const where = { kind_model: { kind: input.kind, model: input.model } };
      const before = await tx.creditPrice.findUnique({ where });
      const after = await tx.creditPrice.upsert({
        where,
        create: input,
        update: { ...input, version: { increment: 1 } },
      });
      await tx.adminAudit.create({
        data: {
          actorId,
          action: 'pricing.save',
          targetId: after.id,
          detail: JSON.parse(JSON.stringify({ before, after })),
        },
      });
      return after;
    });
  }
  async settings() {
    return this.credits.settings();
  }
  async saveSettings(actorId: string, raw: unknown) {
    const input = PlatformSettingsSchema.parse(raw);
    return this.prisma.$transaction(async (tx) => {
      const before = await this.credits.settings(tx);
      for (const [key, value] of Object.entries(input))
        await tx.platformSetting.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        });
      await tx.adminAudit.create({
        data: {
          actorId,
          action: 'settings.save',
          targetId: 'platform-settings',
          detail: { before, after: input },
        },
      });
      return input;
    });
  }
  async audits(raw: unknown) {
    const { page, pageSize } = PageQuerySchema.parse(raw);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.adminAudit.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.adminAudit.count(),
    ]);
    return { items, total, page, pageSize };
  }
}
