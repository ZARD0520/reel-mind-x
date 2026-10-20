import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreditQuoteInputSchema, type CreditQuote, type CreditQuoteInput } from '@reel/contracts';
import { Prisma } from '@reel/db';
import { randomUUID } from 'crypto';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

@Injectable()
export class CreditsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(CreditsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.expireHolds().catch((error) => this.logger.warn(String(error))),
      60000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async account(tx: Tx, userId: string) {
    // The account row is the serialization point for all balance mutations, including first use.
    await tx.$executeRaw`INSERT INTO credit_accounts ("userId", "available", "frozen", "spent", "createdAt", "updatedAt")
      VALUES (${userId}, 0, 0, 0, NOW(), NOW()) ON CONFLICT ("userId") DO NOTHING`;
    await tx.$queryRaw`SELECT "userId" FROM credit_accounts WHERE "userId" = ${userId} FOR UPDATE`;
    const grantKey = `signup:${userId}`;
    if (!(await tx.creditEntry.findUnique({ where: { key: grantKey } }))) {
      const setting = await tx.platformSetting.findUnique({ where: { key: 'signupCredits' } });
      const amount = setting?.value ?? 100;
      const account = await tx.creditAccount.update({
        where: { userId },
        data: { available: { increment: amount } },
      });
      await tx.creditEntry.create({
        data: {
          userId,
          key: grantKey,
          type: 'grant',
          amount,
          availableDelta: amount,
          frozenDelta: 0,
          availableAfter: account.available,
          frozenAfter: account.frozen,
          reason: '首次开通试用积分',
        },
      });
    }
    return tx.creditAccount.findUniqueOrThrow({ where: { userId } });
  }

  async balance(userId: string) {
    return this.prisma.$transaction((tx) => this.account(tx, userId));
  }

  async settings(db: Tx | PrismaService = this.prisma) {
    const rows = await db.platformSetting.findMany();
    const value = (key: string, fallback: number) =>
      rows.find((row) => row.key === key)?.value ?? fallback;
    return {
      signupCredits: value('signupCredits', 100),
      dailyCredits: value('dailyCredits', 10000),
      maxConcurrent: value('maxConcurrent', 3),
    };
  }

  async assertConcurrentLimit(tx: Tx, userId: string, excludeTaskId?: string) {
    await this.account(tx, userId);
    const { maxConcurrent } = await this.settings(tx);
    const tasks = await tx.generationTask.count({
      where: {
        userId,
        status: { notIn: ['completed', 'failed'] },
        ...(excludeTaskId ? { id: { not: excludeTaskId } } : {}),
      },
    });
    const operations = await tx.creditHold.count({
      where: { userId, status: 'held', expiresAt: { gt: new Date() } },
    });
    if (tasks + operations >= maxConcurrent)
      throw new HttpException(
        `同时最多处理 ${maxConcurrent} 个生成任务或对话，请等待已有任务完成`,
        429,
      );
  }

  async quote(raw: unknown, db: Tx | PrismaService = this.prisma): Promise<CreditQuote> {
    const input = CreditQuoteInputSchema.parse(raw);
    const model =
      input.model ??
      (input.kind === 'chat'
        ? 'glm-4-flash'
        : this.config.get(
            input.kind === 'text'
              ? 'GLM_MODEL'
              : input.kind === 'image'
                ? 'GLM_IMAGE_MODEL'
                : 'GLM_VIDEO_MODEL',
            { infer: true },
          )) ??
      (input.kind === 'image'
        ? 'cogview-3-flash'
        : input.kind === 'video'
          ? 'cogvideox-flash'
          : 'glm-4-flash');
    const prices = await db.creditPrice.findMany({
      where: { kind: input.kind, model: { in: [model, '*'] } },
    });
    const price =
      prices.find((value) => value.model === model) ?? prices.find((value) => value.model === '*');
    if (!price?.enabled) throw new BadRequestException('该模型暂未开放生成，请联系管理员');
    const perItem = price.credits * (price.unit === 'second' ? input.duration : 1);
    return {
      kind: input.kind,
      model,
      priceId: price.id,
      version: price.version,
      unit: price.unit as 'request' | 'second',
      unitCredits: price.credits,
      perItem,
      count: input.count,
      total: perItem * input.count,
    };
  }

  async reserve(
    tx: Tx,
    userId: string,
    amount: number,
    key: string,
    reason: string,
    referenceId?: string,
    expiresAt?: Date,
  ) {
    const account = await this.account(tx, userId);
    const existing = await tx.creditHold.findUnique({ where: { key } });
    if (existing) {
      if (existing.userId !== userId || existing.amount !== amount)
        throw new ConflictException('积分请求参数不一致');
      return existing;
    }
    if (!Number.isSafeInteger(amount) || amount < 0) throw new BadRequestException('积分金额无效');
    const { dailyCredits } = await this.settings(tx);
    if (dailyCredits > 0) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const used = await tx.creditHold.aggregate({
        where: { userId, status: { in: ['held', 'captured'] }, createdAt: { gte: today } },
        _sum: { amount: true },
      });
      if ((used._sum.amount ?? 0) + amount > dailyCredits)
        throw new HttpException(`已达到每日 ${dailyCredits} 积分的消耗上限，请明日再试`, 429);
    }
    if (account.available < amount)
      throw new HttpException(
        {
          message: `积分不足，本次需要 ${amount} 积分，可用 ${account.available} 积分`,
          code: 'INSUFFICIENT_CREDITS',
          required: amount,
          available: account.available,
        },
        402,
      );
    const updated = await tx.creditAccount.update({
      where: { userId },
      data: { available: { decrement: amount }, frozen: { increment: amount } },
    });
    const hold = await tx.creditHold.create({
      data: { userId, amount, key, reason, referenceId, expiresAt },
    });
    await tx.creditEntry.create({
      data: {
        userId,
        key: `${hold.id}:reserve`,
        type: 'reserve',
        amount,
        availableDelta: -amount,
        frozenDelta: amount,
        availableAfter: updated.available,
        frozenAfter: updated.frozen,
        reason,
        referenceId,
      },
    });
    return hold;
  }

  async settle(tx: Tx, id: string, success: boolean) {
    await tx.$queryRaw`SELECT id FROM credit_holds WHERE id = ${id} FOR UPDATE`;
    const hold = await tx.creditHold.findUniqueOrThrow({ where: { id } });
    if (hold.status !== 'held') return hold;
    await this.account(tx, hold.userId);
    const account = await tx.creditAccount.update({
      where: { userId: hold.userId },
      data: {
        frozen: { decrement: hold.amount },
        ...(success
          ? { spent: { increment: hold.amount } }
          : { available: { increment: hold.amount } }),
      },
    });
    const status = success ? 'captured' : 'refunded';
    await tx.creditEntry.create({
      data: {
        userId: hold.userId,
        key: `${id}:${status}`,
        type: success ? 'capture' : 'refund',
        amount: hold.amount,
        availableDelta: success ? 0 : hold.amount,
        frozenDelta: -hold.amount,
        availableAfter: account.available,
        frozenAfter: account.frozen,
        reason: `${hold.reason} · ${success ? '成功扣除' : '失败退还'}`,
        referenceId: hold.referenceId,
      },
    });
    return tx.creditHold.update({ where: { id }, data: { status } });
  }

  async beginOperation(
    userId: string,
    input: Partial<CreditQuoteInput> & { kind: 'text' | 'chat' },
    referenceId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertConcurrentLimit(tx, userId);
      const quote = await this.quote(input, tx);
      return this.reserve(
        tx,
        userId,
        quote.total,
        `operation:${randomUUID()}`,
        input.kind === 'chat' ? 'Agent 对话' : '文本生成',
        referenceId,
        new Date(Date.now() + 30 * 60000),
      );
    });
  }
  async finishOperation(id: string, success: boolean) {
    const hold = await this.prisma.$transaction((tx) => this.settle(tx, id, success));
    if (success && hold.status !== 'captured')
      throw new ConflictException('生成已超时，积分已退还，请重新提交');
    return hold;
  }

  async closeCanvasTasks(tx: Tx, canvasId: string) {
    const tasks = await tx.generationTask.findMany({
      where: { canvasId },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const settlements: { id: string; success: boolean }[] = [];
    for (const task of tasks) {
      await tx.$queryRaw`SELECT id FROM generation_tasks WHERE id = ${task.id} FOR UPDATE`;
    }
    for (const task of tasks) {
      await tx.$queryRaw`SELECT id FROM generation_task_items WHERE "taskId" = ${task.id} ORDER BY id FOR UPDATE`;
      const items = await tx.generationTaskItem.findMany({ where: { taskId: task.id } });
      for (const item of items) {
        if (item.creditHoldId)
          settlements.push({ id: item.creditHoldId, success: item.status === 'completed' });
        if (!['completed', 'failed'].includes(item.status))
          await tx.generationTaskItem.update({
            where: { id: item.id },
            data: {
              status: 'failed',
              error: '工作流已删除，生成已终止，冻结积分已退还',
              errorCode: 'SCOPE_DELETED',
              leaseToken: null,
              leaseExpiresAt: null,
              revision: { increment: 1 },
              completedAt: new Date(),
            },
          });
      }
      await tx.generationTask.update({
        where: { id: task.id },
        data: {
          status: items.every((item) => item.status === 'completed') ? 'completed' : 'failed',
          activeNodeKey: null,
        },
      });
    }
    return settlements;
  }
  private async expireHolds() {
    const holds = await this.prisma.creditHold.findMany({
      where: { status: 'held', expiresAt: { lte: new Date() } },
      take: 100,
    });
    for (const hold of holds) await this.finishOperation(hold.id, false);
  }
}
