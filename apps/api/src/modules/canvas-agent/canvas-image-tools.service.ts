import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CanvasGraphSchema, CreateGenerationTaskSchema, KOLORS_MODEL } from '@reel/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { GenerationTasksService } from '../generation-tasks/generation-tasks.service';
import type { CanvasToolScope } from './canvas-tools.service';
import { AgentFailure, jsonValue } from './agent-store';

/** A generation intent, its credit holds and its MCP receipt commit together.
 * The existing generation outbox dispatches only after that transaction commits. */
@Injectable()
export class CanvasImageToolsService {
  constructor(private readonly prisma: PrismaService, private readonly tasks: GenerationTasksService, private readonly config: ConfigService) {}

  async status(scope: CanvasToolScope, taskId: string) {
    if (!await this.prisma.generationTask.findFirst({ where: { id: taskId, userId: scope.userId, canvasId: scope.canvasId } })) throw new BadRequestException('生成任务不存在或无权访问');
    return this.tasks.get(scope.userId, taskId);
  }

  async submit(scope: CanvasToolScope, input: { expectedRevision: string; nodeId: string }): Promise<Record<string, unknown>> {
    const execution = scope.execution;
    if (!execution) throw new BadRequestException('图片生成必须由已持久化的执行计划调用');
    const step = await this.prisma.canvasAgentStep.findFirst({ where: { id: execution.stepId, runId: execution.runId,
      tool: 'generate_image', run: { conversation: { userId: scope.userId, canvasId: scope.canvasId } } } });
    if (!step) throw new BadRequestException('任务步骤不匹配');
    const row = await this.prisma.canvas.findFirstOrThrow({ where: { id: scope.canvasId, userId: scope.userId } });
    if (step.status === 'completed') return { ...step.result as Record<string, unknown>, graph: row.graph };
    if (row.updatedAt.toISOString() !== input.expectedRevision) throw new AgentFailure('REVISION_CONFLICT', '画布已变化，请重新读取上下文');
    const graph = CanvasGraphSchema.parse(row.graph);
    const node = graph.nodes.find(n => n.id === input.nodeId);
    if (!node || node.data.kind !== 'image' || node.data.uploaded || node.data.status === 'generating') throw new BadRequestException('目标必须是当前可生成的图片节点');
    const prompt = String(node.data.prompt ?? '');
    const ids = Array.isArray(node.data.referenceNodeIds) ? node.data.referenceNodeIds as string[] : [];
    const refs = ids.map(id => {
      const source = graph.nodes.find(n => n.id === id);
      if (!source || !graph.edges.some(e => e.source === id && e.target === node.id)) throw new BadRequestException('依赖节点或连线不存在');
      if (source.data.kind !== 'text' && source.data.kind !== 'image') throw new BadRequestException('图片生成仅支持文字或图片参考');
      if (source.data.kind === 'image' && (source.data.status !== 'ready' || !source.data.assetId)) throw new BadRequestException('参考图片尚未生成或上传完成');
      return source;
    });
    const images = refs.filter(n => n.data.kind === 'image');
    const model = String(node.data.model || (images.length ? KOLORS_MODEL : this.config.get('GLM_IMAGE_MODEL') || 'cogview-3-flash'));
    const readable = prompt.replace(/@\[([^\]]*)\]\(node:([^)]*)\)/g, (_token, _title: string, rawId: string) => {
      const source = refs.find(n => n.id === decodeURIComponent(rawId));
      if (!source) throw new BadRequestException('提示词引用与节点依赖不一致');
      return `【${source.data.title}】${source.data.kind === 'text' ? source.data.content || source.data.prompt || '' : ''}`;
    });
    const combined = /@\[/.test(prompt) ? readable : [
      ...refs.filter(n => n.data.kind === 'text').map(n => `【${n.data.title}】${n.data.content || n.data.prompt || ''}`), readable,
    ].filter(Boolean).join('\n\n');
    const request = CreateGenerationTaskSchema.parse({ requestId: step.id, canvasId: scope.canvasId, nodeId: node.id, kind: 'image', count: 1,
      prompt: combined, userPrompt: prompt.replace(/@\[([^\]]*)\]\(node:[^)]*\)/g, (_, title: string) => `【${decodeURIComponent(title)}】`), model,
      size: node.data.generationSize || '1024x1024', quality: node.data.generationQuality || 'standard',
      imageAssetIds: images.map(n => n.data.assetId), references: refs.map(n => ({ kind: n.data.kind, name: n.data.title,
        content: n.data.kind === 'text' ? String(n.data.content || n.data.prompt || '') : undefined,
        assetId: n.data.assetId, url: n.data.url ?? undefined })),
    });
    let receipt: Record<string, unknown> | undefined;
    await this.tasks.create(scope.userId, request, {
      validate: async tx => {
        const lease = await tx.canvasAgentLease.findFirst({ where: { canvasId: scope.canvasId, runId: execution.runId, token: execution.token, expiresAt: { gt: new Date() } } });
        if (!lease) throw new AgentFailure('LEASE_LOST', '任务执行权已失效');
        const latest = await tx.canvas.findUniqueOrThrow({ where: { id: scope.canvasId } });
        if (latest.updatedAt.getTime() !== row.updatedAt.getTime()) throw new AgentFailure('REVISION_CONFLICT', '画布已变化，请重新读取上下文');
        const persisted = await tx.canvasAgentStep.findUniqueOrThrow({ where: { id: step.id } });
        if (persisted.status === 'completed') throw new AgentFailure('REVISION_CONFLICT', '此步骤已由其他执行器提交');
      },
      commit: async (tx, task) => {
        node.data = { ...node.data, status: 'generating', model, generationCount: 1,
          generationTaskId: task.id, generationRequestId: task.requestId, generationStartedAt: task.createdAt.toISOString(), generationRevision: 0, generationStatus: 'queued', generationDetached: false,
          generationFailureVisible: true, generationMessage: '', error: '' };
        const updatedAt = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1));
        await tx.canvas.update({ where: { id: scope.canvasId }, data: { graph: jsonValue(graph), updatedAt } });
        receipt = { generatedNodeId: node.id, generationTaskId: task.id, requestId: task.requestId, model,
          generationStatus: 'queued', generationRevision: 0, estimatedCredits: (task.creditQuote as { total?: number }).total,
          nodeStates: [{ id: node.id, data: node.data }], revision: updatedAt.toISOString() };
        await tx.canvasAgentStep.update({ where: { id: step.id }, data: { status: 'completed', result: jsonValue(receipt), error: null, errorCode: null } });
      },
    }).catch(error => {
      if (error instanceof HttpException && error.getStatus() === 429 && /同时最多/.test(error.message)) throw new AgentFailure('GENERATION_CAPACITY', '生成名额已满，等待已有任务完成后继续');
      throw error;
    });
    // Concurrent retries can replay the task. The atomic receipt is authoritative.
    if (!receipt) receipt = (await this.prisma.canvasAgentStep.findUniqueOrThrow({ where: { id: step.id } })).result as Record<string, unknown>;
    if (!receipt) throw new AgentFailure('INVALID_RECEIPT', '图片生成缺少提交凭证');
    const committed = await this.prisma.canvas.findFirstOrThrow({ where: { id: scope.canvasId, userId: scope.userId } });
    return { ...receipt, graph: committed.graph };
  }
}
