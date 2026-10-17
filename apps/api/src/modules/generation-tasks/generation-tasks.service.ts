import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateGenerationTaskSchema,
  GenerationTaskSchema,
  type CreateGenerationTaskInput,
  type GenerationTask,
} from '@reel/contracts';
import { Prisma } from '@reel/db';
import type { Queue } from 'bullmq';
import { createHash } from 'crypto';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';

export const GENERATION_QUEUE = 'generation-tasks';
const INCLUDE_TASK = { items: { orderBy: { index: 'asc' as const }, include: { asset: true } } };
export type TaskRow = Prisma.GenerationTaskGetPayload<{ include: typeof INCLUDE_TASK }>;
export const isActive = (status: string) => status !== 'completed' && status !== 'failed';
export const canResumeItem = (item: {
  status: string;
  providerTaskId: string | null;
  providerResult: unknown;
}) =>
  (item.status === 'unknown' && (!!item.providerTaskId || !!item.providerResult)) ||
  (item.status === 'failed' && !!item.providerResult);

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

@Injectable()
export class GenerationTasksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GenerationTasksService.name);
  private timer?: ReturnType<typeof setInterval>;
  private dispatching = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @InjectQueue(GENERATION_QUEUE) private readonly queue: Queue,
  ) {}

  onModuleInit() {
    void this.queue
      .setGlobalConcurrency(3)
      .catch((error: Error) => this.logger.warn(`Generation concurrency: ${error.message}`));
    this.timer = setInterval(() => {
      void this.dispatchDue().catch((error: Error) =>
        this.logger.warn(`Generation recovery: ${error.message}`),
      );
    }, 3000);
    this.timer.unref();
    void this.dispatchDue().catch((error: Error) =>
      this.logger.warn(`Generation recovery: ${error.message}`),
    );
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async create(userId: string, raw: unknown): Promise<GenerationTask> {
    const input = CreateGenerationTaskSchema.parse(raw);
    const inputHash = createHash('sha256').update(stable(input)).digest('hex');
    const existing = await this.prisma.generationTask.findUnique({
      where: { userId_requestId: { userId, requestId: input.requestId } },
      include: INCLUDE_TASK,
    });
    if (existing) return this.replay(existing, inputHash);
    const scope = input.canvasId
      ? await this.prisma.canvas.findFirst({
          where: { id: input.canvasId, userId },
          select: { id: true },
        })
      : await this.prisma.project.findFirst({
          where: { id: input.projectId, userId, deletedAt: null },
          select: { id: true },
        });
    if (!scope) throw new NotFoundException('Generation scope not found');
    const model =
      input.model ??
      this.config.get(
        input.kind === 'text'
          ? 'GLM_MODEL'
          : input.kind === 'image'
            ? 'GLM_IMAGE_MODEL'
            : 'GLM_VIDEO_MODEL',
        { infer: true },
      ) ??
      (input.kind === 'text'
        ? 'glm-4-flash'
        : input.kind === 'image'
          ? 'cogview-3-flash'
          : 'cogvideox-flash');
    const references = [...input.references];
    if (input.kind === 'video' && input.imageAssetIds.length) {
      if (new Set(input.imageAssetIds).size !== input.imageAssetIds.length)
        throw new BadRequestException('首帧和尾帧不能使用同一个图片素材');
      const frames = await this.prisma.asset.findMany({
        where: {
          id: { in: input.imageAssetIds },
          userId,
          kind: 'image',
          status: 'ready',
          ...(input.canvasId ? { canvasId: input.canvasId } : { projectId: input.projectId }),
        },
        select: { id: true, name: true, url: true, localPath: true },
      });
      if (frames.length !== input.imageAssetIds.length || frames.some((frame) => !frame.localPath))
        throw new BadRequestException('首尾帧必须是当前画布中已生成完成的图片');
      for (const id of input.imageAssetIds) {
        const frame = frames.find((candidate) => candidate.id === id)!;
        if (!references.some((reference) => reference.kind === 'image' && reference.assetId === id))
          references.push({
            kind: 'image',
            name: frame.name,
            url: frame.url ?? undefined,
            assetId: id,
          });
      }
    }
    if (references.length > 100) throw new BadRequestException('参考内容最多支持 100 项');
    const snapshot = { ...input, model, references };
    try {
      const task = await this.prisma.generationTask.create({
        data: {
          userId,
          canvasId: input.canvasId,
          projectId: input.projectId,
          nodeId: input.nodeId,
          requestId: input.requestId,
          inputHash,
          kind: input.kind,
          model,
          activeNodeKey: this.nodeKey(userId, input.canvasId, input.nodeId),
          input: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
          items: {
            create: Array.from({ length: input.count }, (_, index) => ({
              index,
              asset: {
                create: {
                  userId,
                  canvasId: input.canvasId,
                  projectId: input.projectId,
                  kind: input.kind,
                  source: 'ai',
                  status: 'generating',
                  model,
                  name: `AI ${input.kind}: ${(input.userPrompt ?? input.prompt).slice(0, 30)}`,
                  prompt: (input.userPrompt ?? input.prompt).slice(0, 2000),
                  references: JSON.parse(JSON.stringify(references)) as Prisma.InputJsonValue,
                },
              },
            })),
          },
        },
        include: INCLUDE_TASK,
      });
      void this.dispatchDue().catch((error: Error) =>
        this.logger.warn(`Generation enqueue deferred: ${error.message}`),
      );
      return this.toTask(task);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.prisma.generationTask.findUnique({
          where: { userId_requestId: { userId, requestId: input.requestId } },
          include: INCLUDE_TASK,
        });
        if (replay) return this.replay(replay, inputHash);
        const active = await this.prisma.generationTask.findUnique({
          where: { activeNodeKey: this.nodeKey(userId, input.canvasId, input.nodeId) ?? '' },
        });
        if (active)
          throw new ConflictException({
            message: '该节点正在生成，请等待当前任务结束',
            taskId: active.id,
          });
      }
      throw error;
    }
  }

  private nodeKey(userId: string, canvasId?: string | null, nodeId?: string | null) {
    return canvasId && nodeId ? `${userId}/${canvasId}/${nodeId}` : null;
  }
  private replay(task: TaskRow, hash: string) {
    if (task.inputHash !== hash)
      throw new ConflictException('同一个请求标识不能用于不同的生成参数');
    return this.toTask(task);
  }
  async get(userId: string, id: string) {
    const task = await this.prisma.generationTask.findFirst({
      where: { id, userId },
      include: INCLUDE_TASK,
    });
    if (!task) throw new NotFoundException('Generation task not found');
    return this.toTask(task);
  }
  async waitForText(userId: string, id: string) {
    for (let attempt = 0; attempt < 120; attempt++) {
      const task = await this.get(userId, id);
      const asset = task.items[0]?.asset;
      if (task.status === 'completed' && asset)
        return { text: asset.content ?? '', model: asset.model ?? task.model, assetId: asset.id };
      if (task.status === 'failed' || task.status === 'unknown')
        throw new HttpException(
          { message: task.error ?? '文本生成失败', taskId: id },
          task.error === '模型繁忙，请更换模型或稍后再试' ? 429 : 502,
        );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new HttpException({ message: '任务仍在后台处理中，请稍后查看生成历史', taskId: id }, 504);
  }
  async list(userId: string, canvasId: string) {
    const canvas = await this.prisma.canvas.findFirst({
      where: { id: canvasId, userId },
      select: { id: true },
    });
    if (!canvas) throw new NotFoundException('Canvas not found');
    // One latest task per node, with no arbitrary history limit that could hide an old running node.
    const latest = await this.prisma.$queryRaw<{ id: string }[]>`SELECT DISTINCT ON ("nodeId") id
      FROM generation_tasks WHERE "userId" = ${userId} AND "canvasId" = ${canvasId} AND "nodeId" IS NOT NULL
      ORDER BY "nodeId", "createdAt" DESC, id DESC`;
    const tasks = await this.prisma.generationTask.findMany({
      where: { id: { in: latest.map((task) => task.id) } },
      orderBy: { createdAt: 'desc' },
      include: INCLUDE_TASK,
    });
    return tasks.map((task) => this.toTask(task));
  }

  async resume(userId: string, id: string) {
    const task = await this.prisma.generationTask.findFirst({
      where: { id, userId },
      include: INCLUDE_TASK,
    });
    if (!task) throw new NotFoundException('Generation task not found');
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM generation_tasks WHERE id = ${id} FOR UPDATE`;
        const current = await tx.generationTaskItem.findMany({ where: { taskId: id } });
        const resumable = current.filter(canResumeItem);
        if (!resumable.length) throw new ConflictException('当前没有可以安全恢复的查询或保存步骤');
        await tx.generationTask.update({
          where: { id },
          data: {
            status: 'queued',
            activeNodeKey: this.nodeKey(userId, task.canvasId, task.nodeId),
          },
        });
        for (const item of resumable) {
          await tx.generationTaskItem.update({
            where: { id: item.id },
            data: {
              status: item.providerResult ? 'saving' : 'generating',
              error: null,
              errorCode: null,
              pollFailures: 0,
              saveAttempts: 0,
              nextRunAt: new Date(),
              leaseToken: null,
              leaseExpiresAt: null,
              revision: { increment: 1 },
            },
          });
          if (item.assetId)
            await tx.asset.update({
              where: { id: item.assetId },
              data: { status: 'generating', error: null },
            });
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('该节点已有其他进行中的任务');
      throw error;
    }
    void this.dispatchDue().catch((error: Error) => this.logger.warn(error.message));
    return this.get(userId, id);
  }

  async refresh(id: string) {
    // Serialize updates of sibling items so the last finisher always releases the node lock.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM generation_tasks WHERE id = ${id} FOR UPDATE`;
      const task = await tx.generationTask.findUnique({ where: { id }, include: { items: true } });
      if (!task) return;
      const status = this.aggregate(task.items);
      await tx.generationTask.update({
        where: { id },
        data: { status, ...(!isActive(status) ? { activeNodeKey: null } : {}) },
      });
    });
  }

  private aggregate(items: { status: string }[]) {
    const active = items.filter((item) => isActive(item.status));
    if (!active.length)
      return items.every((item) => item.status === 'completed') ? 'completed' : 'failed';
    for (const state of ['submitting', 'saving', 'generating', 'queued', 'unknown'])
      if (active.some((item) => item.status === state)) return state;
    return 'unknown';
  }

  private toTask(task: TaskRow): GenerationTask {
    return GenerationTaskSchema.parse({
      ...task,
      status: this.aggregate(task.items),
      error: task.items.find((item) => item.error)?.error ?? null,
      canResume: task.items.some(canResumeItem),
      items: task.items.map((item) => ({ ...item, canResume: canResumeItem(item) })),
    });
  }

  async dispatchDue() {
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      const due = await this.prisma.generationTaskItem.findMany({
        where: {
          status: { in: ['queued', 'submitting', 'generating', 'saving'] },
          nextRunAt: { lte: new Date() },
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: new Date() } }],
        },
        select: { id: true, revision: true },
        orderBy: { nextRunAt: 'asc' },
        take: 100,
      });
      const enqueue = Promise.allSettled(
        due.map((item) =>
          this.queue.add('step', item, {
            jobId: `${item.id}-${item.revision}`,
            attempts: 1,
            removeOnComplete: true,
            removeOnFail: true,
          }),
        ),
      );
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const results = await Promise.race([
        enqueue,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Generation queue unavailable; recovery will retry')),
            5000,
          );
        }),
      ]).finally(() => {
        if (timeout) clearTimeout(timeout);
      });
      if (results.some((result) => result.status === 'rejected'))
        this.logger.warn(
          'Some generation steps could not be enqueued; database recovery will retry',
        );
      // Recover group summaries if a worker stopped after committing a completed item.
      const active = await this.prisma.generationTask.findMany({
        where: { status: { notIn: ['completed', 'failed'] } },
        select: { id: true },
        orderBy: { updatedAt: 'asc' },
        take: 100,
      });
      for (const task of active) await this.refresh(task.id);
    } finally {
      this.dispatching = false;
    }
  }
}
