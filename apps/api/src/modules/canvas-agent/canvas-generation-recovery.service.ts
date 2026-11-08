import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AGENT_ACTIVE_STATES, AGENT_INTERRUPTED_STATES, AGENT_RECOVERABLE_ERRORS, agentCanRecover, acceptsGenerationSnapshot, generationSnapshot, CanvasGraphSchema, type GenerationTask } from '@reel/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { CanvasAgentService } from './canvas-agent.service';
import { CanvasMcpService } from './canvas-mcp.service';
import { AgentFailure, jsonValue } from './agent-store';
import { PRIMARY_AGENT_MODEL } from './model-retry';
import { diagnosticError } from './agent-diagnostics';
import { generationTaskView } from '../generation-tasks/generation-tasks.service';

/** Durable continuation of a saved plan. No planning/model call is made here.
 * Every API process may run this scanner: the existing canvas lease fences the
 * executor, and the canvas row lock fences reconciliation. */
@Injectable()
export class CanvasGenerationRecovery implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CanvasGenerationRecovery.name);
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private cursor?: string;
  constructor(private readonly prisma: PrismaService, private readonly agent: CanvasAgentService, private readonly mcp: CanvasMcpService) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.tick().catch(error => this.logger.error(JSON.stringify(diagnosticError(error)))); }, 3000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      // A user may safely resume a failed save using the existing task API.
      // Its original Agent run is terminal, so receipt-only scans miss it.
      const resumed = await this.prisma.$queryRaw<{ id: string }[]>`SELECT DISTINCT r.id
        FROM canvas_agent_runs r
        JOIN canvas_agent_steps s ON s."runId" = r.id
        JOIN canvas_conversations c ON c.id = r."conversationId"
        JOIN generation_tasks t ON t."requestId" = s.id AND t."userId" = c."userId" AND t."canvasId" = c."canvasId"
        WHERE r.status IN ('completed', 'completed_with_errors', 'partial', 'failed', 'interrupted', 'cancelled') AND s.tool = 'generate_image' AND s.status = 'completed'
          AND s.result->>'generationTaskId' = t.id AND (
            t.status IN ('queued', 'submitting', 'generating', 'saving', 'unknown') OR t.status <> s.result->>'generationStatus'
            OR (SELECT COALESCE(SUM(i.revision), 0) FROM generation_task_items i WHERE i."taskId" = t.id) > COALESCE((s.result->>'generationRevision')::bigint, -1)
          )
          AND (${this.cursor ?? null}::text IS NULL OR r.id > ${this.cursor ?? null}::text)
        ORDER BY r.id LIMIT 100`;
      const runs = await this.prisma.canvasAgentRun.findMany({ where: { OR: [
        { id: { in: resumed.map(run => run.id) } },
        { status: 'waiting_generation' },
        { deliveredAt: { not: null }, steps: { some: { tool: 'generate_image' } }, OR: [
          { status: { in: [...AGENT_ACTIVE_STATES] } },
          { status: { in: [...AGENT_INTERRUPTED_STATES] }, errorCode: { in: [...AGENT_RECOVERABLE_ERRORS] } },
        ] },
        { steps: { some: { tool: 'generate_image', status: 'completed', OR: ['queued', 'submitting', 'generating', 'saving', 'unknown'].map(status => ({ result: { path: ['generationStatus'], equals: status } })) } } },
      ] }, orderBy: { id: 'asc' }, ...(this.cursor ? { cursor: { id: this.cursor }, skip: 1 } : {}), take: 100, include: { conversation: true, steps: { orderBy: { ordinal: 'asc' } } } });
      this.cursor = runs.length === 100 ? runs.at(-1)!.id : undefined;
      for (const run of runs) {
        try {
          const scope = { userId: run.conversation.userId, canvasId: run.conversation.canvasId, selectedNodeIds: [] as string[] };
          await this.restoreDetached(run.id, scope.canvasId);
          const session = await this.mcp.connect(scope);
          const tasks = new Map<string, GenerationTask>();
          try {
            for (const step of run.steps.filter(s => s.tool === 'generate_image' && s.status === 'completed')) {
              const taskId = (step.result as { generationTaskId?: string } | null)?.generationTaskId;
              if (!taskId) continue;
              const response = await session.client.callTool({ name: 'get_image_generation_status', arguments: { taskId } });
              if (response.isError || !response.structuredContent) throw new Error('无法查询已提交的图片生成任务');
              tasks.set(step.id, response.structuredContent as unknown as GenerationTask);
            }
          } finally { await session.close(); }
          await this.reconcile(run.id, scope, tasks);
          // A waiting run may still contain unsubmitted generation steps due to
          // capacity limits. Resume its exact saved plan, never re-plan it.
          const latest = await this.prisma.canvasAgentRun.findUnique({ where: { id: run.id } });
          if (latest?.status !== 'waiting_generation' || !latest.deliveredAt || run.steps.every(s => s.status === 'completed')) continue;
          const input = latest.input as { content?: string; selectedNodeIds?: string[] };
          if (!latest.requestId || !input.content) continue;
          let ticket;
          try { ticket = await this.agent.claim({ ...scope, selectedNodeIds: input.selectedNodeIds ?? [] }, run.conversationId, latest.requestId, latest.input, true); }
          catch (error) {
            if ((error as { getStatus?: () => number }).getStatus?.() === 409) continue;
            throw error;
          }
          try {
            if (!ticket.run.plan) {
              await this.agent.store.update(ticket, { status: 'failed', errorCode: 'CHECKPOINT_INVALID', error: '图片任务缺少已保存的执行计划' });
              throw new AgentFailure('CHECKPOINT_INVALID', '图片任务缺少已保存的执行计划，不能重新规划');
            }
            for await (const _event of this.agent.execute(ticket, [{ role: 'user', content: input.content }], PRIMARY_AGENT_MODEL, AbortSignal.timeout(110000))) { /* persisted progress is authoritative */ }
          } catch (error) {
            this.logger.error(JSON.stringify({ runId: run.id, ...diagnosticError(error) }));
          } finally { await this.agent.store.release(ticket); }
          await this.prisma.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM canvases WHERE id = ${scope.canvasId} FOR UPDATE`;
            const updated = await tx.canvasAgentRun.findUnique({ where: { id: run.id } });
            const content = updated?.status === 'waiting_generation' ? updated.response : updated && ['failed', 'partial'].includes(updated.status)
              ? '图片计划未能全部提交，已提交的任务会继续生成。请检查节点状态和积分后重试未提交的图片。' : null;
            if (content) await tx.canvasChatMessage.updateMany({ where: { runId: run.id, role: 'assistant' }, data: { content } });
          });
        } catch (error) { this.logger.error(JSON.stringify({ runId: run.id, ...diagnosticError(error) })); }
      }
    } finally { this.busy = false; }
  }

  private async restoreDetached(runId: string, canvasId: string) {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM canvases WHERE id = ${canvasId} FOR UPDATE`;
      if (await tx.canvasAgentLease.findFirst({ where: { canvasId, expiresAt: { gt: new Date() } } })) return;
      const run = await tx.canvasAgentRun.findUnique({ where: { id: runId } });
      if (!run?.deliveredAt) return;
      if (agentCanRecover(run.status, run.errorCode)) await tx.canvasAgentRun.update({ where: { id: runId }, data: { status: 'waiting_generation', error: null, errorCode: null } });
    });
  }

  async reconcile(runId: string, scope: { userId: string; canvasId: string }, tasks: Map<string, GenerationTask>) {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM canvases WHERE id = ${scope.canvasId} AND "userId" = ${scope.userId} FOR UPDATE`;
      // Never mutate a graph under an active executor (or another user turn).
      if (await tx.canvasAgentLease.findFirst({ where: { canvasId: scope.canvasId, expiresAt: { gt: new Date() } } })) return;
      const row = await tx.canvas.findFirst({ where: { id: scope.canvasId, userId: scope.userId } });
      const run = await tx.canvasAgentRun.findUnique({ where: { id: runId }, include: { steps: true } });
      if (!row || !run) return;
      const graph = CanvasGraphSchema.parse(row.graph);
      // MCP observations can become stale while another API process finishes a
      // task. Re-read under the canvas lock before publishing graph/run state.
      const currentTasks = new Map((await tx.generationTask.findMany({ where: {
        id: { in: [...tasks.values()].map(task => task.id) }, userId: scope.userId, canvasId: scope.canvasId,
      }, include: { items: { orderBy: { index: 'asc' }, include: { asset: true } } } })).map(task => [task.id, generationTaskView(task)]));
      const changedTask = run.steps.some(step => {
        const receipt = step.result as { generationTaskId?: string; generationRevision?: number; generationStatus?: string } | null;
        const task = receipt?.generationTaskId ? currentTasks.get(receipt.generationTaskId) : undefined;
        return task && (task.revision !== receipt?.generationRevision || task.status !== receipt?.generationStatus);
      });
      if (['completed', 'completed_with_errors'].includes(run.status) && changedTask) {
        await tx.canvasAgentRun.update({ where: { id: runId }, data: { status: 'waiting_generation' } });
        run.status = 'waiting_generation';
      }
      const ownedAssets = new Set((await tx.asset.findMany({ where: {
        id: { in: [...currentTasks.values()].flatMap(task => task.items.flatMap(item => item.asset ? [item.asset.id] : [])) }, userId: scope.userId, kind: 'image', status: 'ready',
      }, select: { id: true } })).map(asset => asset.id));
      let changed = false;
      let successful = 0, failed = 0, detached = 0;
      for (const step of run.steps.filter(s => s.tool === 'generate_image' && s.status === 'completed')) {
        const receipt = step.result as Record<string, unknown>;
        const task = currentTasks.get(String(receipt.generationTaskId));
        if (!task || task.id !== receipt.generationTaskId) continue;
        const item = task.items[0];
        const asset = item?.status === 'completed' ? item.asset : null;
        const ready = task.status === 'completed' && asset?.status === 'ready' && ownedAssets.has(asset.id) && !!asset.url;
        const terminal = task.status === 'completed' || task.status === 'failed';
        if (ready) successful++;
        else if (terminal) failed++;
        const node = graph.nodes.find(n => n.id === receipt.generatedNodeId);
        const snapshot = generationSnapshot(task);
        const applies = node && acceptsGenerationSnapshot(node.data, snapshot, true);
        if (terminal && !applies) detached++;
        if (applies) {
          const patch = { ...snapshot, generationCanResume: task.canResume, generationMessage: task.error ?? '',
            status: terminal ? ready ? 'ready' : 'failed' : 'generating', error: terminal && !ready ? task.error || '图片生成失败，请重试该节点' : '',
            ...(terminal ? { generationAppliedTaskId: task.id, generationBatchResultsTaskId: task.id,
              assetId: asset?.id ?? item?.asset?.id, url: ready ? asset!.url : null, content: '', model: task.model } : {}),
          };
          if (Object.entries(patch).some(([key, value]) => node.data[key] !== value)) { node.data = { ...node.data, ...patch }; changed = true; }
        }
        if (receipt.generationStatus !== task.status || receipt.generationRevision !== task.revision) await tx.canvasAgentStep.update({ where: { id: step.id }, data: { result: jsonValue({ ...receipt, generationStatus: task.status, generationRevision: task.revision }) } });
      }
      if (changed) await tx.canvas.update({ where: { id: row.id }, data: { graph: jsonValue(graph), updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) } });
      const generationSteps = run.steps.filter(s => s.tool === 'generate_image');
      if (run.status !== 'waiting_generation' || !run.deliveredAt || !generationSteps.length) return;
      const allSubmitted = run.steps.every(s => s.status === 'completed');
      const total = generationSteps.length;
      const finished = allSubmitted && successful + failed === total;
      const unknown = [...currentTasks.values()].some(t => t.status === 'unknown');
      const response = finished ? `图片生成完成：${successful} 张成功${failed ? `，${failed} 张失败，可单独重试失败节点` : ''}。${detached ? '部分目标节点已更改或删除，结果保留在生成历史中。' : '结果已更新到画布。'}`
        : `图片生成进度：${successful}/${total} 张成功${failed ? `，${failed} 张失败` : ''}。${unknown ? '部分任务结果待确认，请在对应节点继续查询。' : allSubmitted ? '其余任务正在后台生成。' : '其余任务将在有可用名额后继续提交。'}`;
      if (response !== run.response || finished) {
        await tx.canvasAgentRun.update({ where: { id: runId }, data: { response, ...(finished ? { status: failed ? 'completed_with_errors' : 'completed' } : {}) } });
        await tx.canvasChatMessage.updateMany({ where: { runId, role: 'assistant' }, data: { content: response } });
      }
    });
  }
}
