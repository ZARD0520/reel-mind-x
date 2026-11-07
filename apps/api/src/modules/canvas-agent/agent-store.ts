import { ConflictException, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { CanvasAgentRun, Prisma } from '@reel/db';
import type { PrismaService } from '../../prisma/prisma.service';
import type { CanvasToolScope } from './canvas-tools.service';

export const LEASE_MS = 45000;
export const ACTIVE_STATUSES = ['planning', 'executing', 'verifying'];
export const TERMINAL_STATUSES = ['completed', 'awaiting_input'];
export type RunTicket = { run: CanvasAgentRun; token: string; scope: CanvasToolScope };
export const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export class AgentFailure extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export function classifyError(error: unknown) {
  if (error instanceof AgentFailure) return error.code;
  const cause = (error as { cause?: { code?: string } })?.cause;
  if (cause?.code === 'REQUEST_BUDGET' || cause?.code === 'OUTPUT_TOKEN_LIMIT' || cause?.code === 'CONTEXT_BUDGET') return cause.code;
  const value = error as { code?: string; status?: number; message?: string; name?: string };
  if (['P1001', 'P1002', 'P1017', 'P2024', 'P2028', 'P2034'].includes(value?.code ?? '') || /deadlock|serialization|连接.*中断/i.test(value?.message ?? '')) return 'TRANSIENT';
  if (/画布已变化/.test(value?.message ?? '')) return 'REVISION_CONFLICT';
  if (/LEASE_LOST/.test(value?.message ?? '')) return 'LEASE_LOST';
  if (/CONTEXT_BUDGET/.test(value?.message ?? '')) return 'CONTEXT_BUDGET';
  if (value?.status === 429 || (value?.status ?? 0) >= 500) return 'MODEL_UNAVAILABLE';
  if (value?.name === 'LlmError' && /网络|network|fetch failed/i.test(value.message ?? '')) return 'MODEL_UNAVAILABLE';
  return 'INVALID_OPERATION';
}
export class AgentStore {
  constructor(private readonly db: PrismaService) {}

  async claim(scope: CanvasToolScope, conversationId: string, requestId: string, input: unknown, resume = false): Promise<RunTicket> {
    const inputHash = createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex');
    return this.db.$transaction(async tx => {
      // All agents for a canvas share one lease, including other conversations.
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM canvases WHERE id = ${scope.canvasId} AND "userId" = ${scope.userId} FOR UPDATE`;
      if (!rows.length || !await tx.canvasConversation.findFirst({ where: { id: conversationId, canvasId: scope.canvasId, userId: scope.userId } })) throw new NotFoundException('画布或对话不存在');
      const lease = await tx.canvasAgentLease.findUnique({ where: { canvasId: scope.canvasId } });
      if (lease && lease.expiresAt.getTime() > Date.now()) throw new ConflictException('当前画布已有执行中的任务，请稍后再试');
      if (lease) {
        await tx.canvasAgentRun.updateMany({ where: { id: lease.runId, status: { in: ACTIVE_STATUSES } }, data: { status: 'interrupted', errorCode: 'LEASE_EXPIRED', error: '执行连接已中断，可显式恢复此任务' } });
        await tx.canvasAgentLease.delete({ where: { canvasId: scope.canvasId } });
      }
      let run = await tx.canvasAgentRun.findUnique({ where: { conversationId_requestId: { conversationId, requestId } } });
      if (run && run.inputHash !== inputHash) throw new ConflictException('同一请求ID不能用于不同指令');
      if (run && !TERMINAL_STATUSES.includes(run.status) && !resume) throw new ConflictException('此请求已执行或中断，请使用恢复操作继续，或发送新的请求');
      if (run && resume && run.deliveredAt && !TERMINAL_STATUSES.includes(run.status)) throw new ConflictException('已结束的对话不能恢复，请发送新的请求');
      if (run && resume && ['PRECONDITION_CHANGED', 'VERIFICATION_FAILED', 'INVALID_OPERATION', 'CHECKPOINT_INVALID'].includes(run.errorCode ?? '')) throw new ConflictException('此任务需要根据最新画布重新规划，请发送新指令');
      run ??= await tx.canvasAgentRun.create({ data: { conversationId, requestId, inputHash, input: jsonValue(input), status: 'planning' } });
      const token = randomUUID();
      await tx.canvasAgentLease.create({ data: { canvasId: scope.canvasId, runId: run.id, token, expiresAt: new Date(Date.now() + LEASE_MS) } });
      return { run, token, scope };
    });
  }

  async renew(ticket: RunTicket) {
    const changed = await this.db.canvasAgentLease.updateMany({ where: { canvasId: ticket.scope.canvasId, runId: ticket.run.id, token: ticket.token, expiresAt: { gt: new Date() } }, data: { expiresAt: new Date(Date.now() + LEASE_MS) } });
    if (changed.count !== 1) throw new AgentFailure('LEASE_LOST', '任务执行权已失效，请重新读取任务状态');
  }
  async release(ticket: RunTicket) {
    await this.db.canvasAgentLease.deleteMany({ where: { canvasId: ticket.scope.canvasId, token: ticket.token } });
  }
  async updateStep(ticket: RunTicket, id: string, data: Prisma.CanvasAgentStepUpdateManyMutationInput) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM canvases WHERE id = ${ticket.scope.canvasId} FOR UPDATE`;
      if (!await tx.canvasAgentLease.findFirst({ where: { canvasId: ticket.scope.canvasId, runId: ticket.run.id, token: ticket.token, expiresAt: { gt: new Date() } } })) throw new AgentFailure('LEASE_LOST', '任务执行权已失效');
      await tx.canvasAgentStep.updateMany({ where: { id, runId: ticket.run.id, status: { not: 'completed' } }, data });
    });
  }
  async update(ticket: RunTicket, data: Prisma.CanvasAgentRunUpdateInput) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM canvases WHERE id = ${ticket.scope.canvasId} FOR UPDATE`;
      const lease = await tx.canvasAgentLease.findFirst({ where: { canvasId: ticket.scope.canvasId, runId: ticket.run.id, token: ticket.token, expiresAt: { gt: new Date() } } });
      if (!lease) throw new AgentFailure('LEASE_LOST', '任务执行权已失效');
      return tx.canvasAgentRun.update({ where: { id: ticket.run.id }, data });
    });
  }
}
