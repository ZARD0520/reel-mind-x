import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { finalAnswerText, type ChatMessage } from '@reel/llm';
import type { Prisma } from '@reel/db';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { MAX_REFERENCE_IMAGES, readLocalImageAsDataUrl } from '../llm/asset-image';
import { CanvasChatReferenceSchema, type CanvasChatReference } from './canvas-chat.dto';
import { CreditsService } from '../credits/credits.service';
import type { Env } from '../../config/env';
import { chatErrorMessage } from '@reel/contracts';
import { CanvasAgentService, CREATIVE_AGENT_PROMPT } from '../canvas-agent/canvas-agent.service';
import { PRIMARY_AGENT_MODEL } from '../canvas-agent/model-retry';
import { TERMINAL_STATUSES } from '../canvas-agent/agent-store';
import { createAgentDiagnostics } from '../canvas-agent/agent-diagnostics';

const CHAT_MODEL = PRIMARY_AGENT_MODEL;

function readablePrompt(content: string): string {
  return content.replace(/@\[([^\]]*)\]\(node:([^)]*)\)/g, (token, title: string, nodeId: string) => {
    try {
      return `【${decodeURIComponent(title)}】(节点ID：${decodeURIComponent(nodeId)})`;
    } catch {
      return token;
    }
  });
}

function referenceContext(references: CanvasChatReference[]): string {
  if (!references.length) return '';
  const items = references.map((item, index) =>
    [
      `${index + 1}. ${item.kind === 'text' ? '文本' : item.kind === 'image' ? '图片' : '视频'}节点「${item.title}」`,
      `引用 ID：${item.id}`,
      item.content ? `内容：${item.content.slice(0, 4000)}` : '',
      item.prompt ? `生成提示词：${item.prompt}` : '',
      item.description ? `素材信息：${item.description}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  return `\n\n用户引用的当前画布节点：\n${items.join('\n\n')}`;
}

@Injectable()
export class CanvasChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly credits: CreditsService,
    private readonly config: ConfigService<Env, true>,
    private readonly agent: CanvasAgentService,
  ) {}

  private async requireCanvas(userId: string, canvasId: string) {
    const canvas = await this.prisma.canvas.findFirst({ where: { id: canvasId, userId } });
    if (!canvas) throw new NotFoundException('Canvas not found');
  }

  private async requireConversation(userId: string, canvasId: string, conversationId: string) {
    const conversation = await this.prisma.canvasConversation.findFirst({
      where: { id: conversationId, canvasId, userId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  async assertConversation(
    userId: string,
    canvasId: string,
    conversationId: string,
  ): Promise<void> {
    await this.requireConversation(userId, canvasId, conversationId);
  }

  async list(userId: string, canvasId: string) {
    await this.requireCanvas(userId, canvasId);
    return this.prisma.canvasConversation.findMany({
      where: { canvasId, userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
  }

  async create(userId: string, canvasId: string) {
    await this.requireCanvas(userId, canvasId);
    return this.prisma.canvasConversation.create({
      data: { userId, canvasId },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
  }

  async get(userId: string, canvasId: string, conversationId: string) {
    const conversation = await this.requireConversation(userId, canvasId, conversationId);
    const messages = await this.prisma.canvasChatMessage.findMany({
      where: { conversationId },
      // PostgreSQL now() is constant within a transaction: both messages can
      // share a timestamp, so UUID ordering must not put the reply first.
      orderBy: [{ createdAt: 'asc' }, { role: 'desc' }, { id: 'asc' }],
      select: { id: true, role: true, content: true, references: true, createdAt: true },
    });
    return {
      ...conversation,
      agentRuns: (await this.prisma.canvasAgentRun.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' }, select: { id: true, requestId: true, status: true, plan: true, errorCode: true, events: true, error: true, lease: { select: { expiresAt: true } }, steps: { orderBy: { ordinal: 'asc' }, select: { stepKey: true, tool: true, status: true, attempts: true, errorCode: true } } } })).map(({ lease, ...run }) => ({ ...run,
        status: ['planning', 'executing', 'verifying'].includes(run.status) && (!lease || lease.expiresAt <= new Date()) ? 'interrupted' : run.status,
        error: run.error ? chatErrorMessage({ code: run.errorCode, message: run.error }) : null,
      })),
      messages: messages.map((message) => ({
        ...message,
        content: message.role === 'assistant' ? finalAnswerText(message.content) : message.content,
        references: CanvasChatReferenceSchema.array().catch([]).parse(message.references),
      })),
    };
  }

  async rename(userId: string, canvasId: string, conversationId: string, title: string) {
    await this.requireConversation(userId, canvasId, conversationId);
    return this.prisma.canvasConversation.update({
      where: { id: conversationId },
      data: { title },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
  }

  async resumeInput(userId: string, canvasId: string, conversationId: string, runId: string) {
    await this.requireConversation(userId, canvasId, conversationId);
    const run = await this.prisma.canvasAgentRun.findFirst({ where: { id: runId, conversationId } });
    const input = run?.input as { content?: string; references?: unknown; selectedNodeIds?: string[] } | null;
    if (!run?.requestId || !input?.content) throw new BadRequestException('此任务没有可恢复的执行记录');
    return { content: input.content, references: CanvasChatReferenceSchema.array().parse(input.references ?? []), selectedNodeIds: input.selectedNodeIds ?? [], requestId: run.requestId, resume: true };
  }

  async saveErrorTurn(userId: string, canvasId: string, conversationId: string, content: string, references: CanvasChatReference[], error: unknown, requestId?: string) {
    await this.requireConversation(userId, canvasId, conversationId);
    const message = chatErrorMessage(error);
    await this.prisma.$transaction(async tx => {
      const run = requestId ? await tx.canvasAgentRun.findUnique({ where: { conversationId_requestId: { conversationId, requestId } } }) : null;
      if (run?.deliveredAt) return;
      if (run) {
        await tx.canvasChatMessage.upsert({ where: { runId_role: { runId: run.id, role: 'user' } }, create: { conversationId, runId: run.id, role: 'user', content, references: references as Prisma.InputJsonValue }, update: {} });
        await tx.canvasChatMessage.upsert({ where: { runId_role: { runId: run.id, role: 'assistant' } }, create: { conversationId, runId: run.id, role: 'assistant', content: message }, update: { content: message } });
      } else {
        await tx.canvasChatMessage.create({ data: { conversationId, role: 'user', content, references: references as Prisma.InputJsonValue } });
        await tx.canvasChatMessage.create({ data: { conversationId, role: 'assistant', content: message } });
      }
      await tx.canvasConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    });
    return this.get(userId, canvasId, conversationId);
  }

  async remove(userId: string, canvasId: string, conversationId: string): Promise<void> {
    await this.requireConversation(userId, canvasId, conversationId);
    await this.prisma.canvasConversation.delete({ where: { id: conversationId } });
  }

  async *sendStream(
    userId: string,
    canvasId: string,
    conversationId: string,
    content: string,
    references: CanvasChatReference[],
    signal: AbortSignal,
    selectedNodeIds: string[] = [],
    requestId: string = randomUUID(),
    resume = false,
  ) {
    const trace = createAgentDiagnostics({ requestId, canvasId, conversationId });
    trace.stage('conversation.load');
    try {
      const conversation = await this.requireConversation(userId, canvasId, conversationId);
      trace.stage('request.lookup');
      const cached = await this.prisma.canvasAgentRun.findUnique({ where: { conversationId_requestId: { conversationId, requestId } }, select: { status: true, deliveredAt: true } });
      if (cached && TERMINAL_STATUSES.includes(cached.status) && cached.deliveredAt) {
        trace.stage('request.replay');
        // A delivered replay does not depend on assets still existing or on the
        // current prompt/context budget. Claim verifies the original input hash.
        const replay = await this.agent.claim({ userId, canvasId, selectedNodeIds }, conversationId, requestId, { content: content.trim(), references, selectedNodeIds }, resume);
        try { yield { event: 'done', data: await this.get(userId, canvasId, conversationId) }; }
        finally { await this.agent.store.release(replay); }
        return;
      }
      trace.stage('history.load');
      const history = (await this.prisma.canvasChatMessage.findMany({
        where: { conversationId },
        orderBy: [{ createdAt: 'desc' }, { role: 'asc' }, { id: 'desc' }], take: 20,
        select: { role: true, content: true, references: true },
      })).reverse();
      const assetIds = references.flatMap((item) => (item.assetId ? [item.assetId] : []));
      let resolvedReferences = references;
      if (assetIds.length) {
        trace.stage('references.validate', { assetCount: assetIds.length });
        const ownedAssets = await this.prisma.asset.findMany({
          where: { id: { in: assetIds }, userId },
          select: {
            id: true,
            name: true,
            kind: true,
            prompt: true,
            width: true,
            height: true,
            durationInFrames: true,
            url: true,
          },
        });
        if (new Set(ownedAssets.map((asset) => asset.id)).size !== new Set(assetIds).size) {
          throw new BadRequestException('引用的素材不存在');
        }
        const assetsById = new Map(ownedAssets.map((asset) => [asset.id, asset]));
        resolvedReferences = references.map((reference) => {
          const asset = reference.assetId ? assetsById.get(reference.assetId) : undefined;
          if (!asset) return reference;
          if (asset.kind !== reference.kind) throw new BadRequestException('引用的素材类型不匹配');
          return {
            ...reference,
            url: asset.url ?? undefined,
            description: [
              asset.name,
              asset.kind,
              asset.width && asset.height ? `${asset.width}×${asset.height}` : '',
              asset.durationInFrames ? `${asset.durationInFrames} 帧` : '',
              asset.prompt ? `素材提示词：${asset.prompt}` : '',
            ]
              .filter(Boolean)
              .join('；')
              .slice(0, 2000),
          };
        });
      }
      const prompt = content.trim();
      trace.stage('references.images');
      // 引用的图片节点以 base64 随消息传给视觉模型（GLM-4V 系列）；读取失败的跳过
      const referenceImages = await this.resolveReferenceImages(userId, resolvedReferences);
      trace.event('agent.context_ready', { historyMessages: history.length, referenceCount: references.length, images: referenceImages.length });
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content:
            CREATIVE_AGENT_PROMPT + '\n当前选中的节点ID：' + JSON.stringify(selectedNodeIds) + '\n引用的文本节点可直接阅读。' +
            (referenceImages.length
              ? '用户引用的图片节点画面已作为图片附在本条消息中，可以直接查看、描述和分析。视频节点只能依据节点标题、文字内容或生成提示词回答。'
              : '注意：本条消息没有附带任何图片，你看不到任何画面。如果用户询问图片或视频的内容，请明确说明你无法看到画面，只能依据节点标题、文字内容或生成提示词推断，不要编造画面细节。'),
        },
        ...history.map((message, index) => ({
          role: message.role as 'user' | 'assistant',
          content:
            (message.role === 'user' && history[index + 1]?.role === 'assistant' && chatErrorMessage(history[index + 1]!.content) === history[index + 1]!.content
              ? '【历史请求：该轮已失败并结束，仅供理解上下文，不是当前待执行任务】\n' : '') +
            readablePrompt(message.role === 'assistant' ? finalAnswerText(message.content) : message.content) +
            referenceContext(CanvasChatReferenceSchema.array().catch([]).parse(message.references)),
        })),
        {
          role: 'user',
          content: readablePrompt(prompt) + referenceContext(resolvedReferences),
          ...(referenceImages.length ? { images: referenceImages } : {}),
        },
      ];
      const scope = { userId, canvasId, selectedNodeIds };
      trace.stage('run.claim');
      const ticket = await this.agent.claim(scope, conversationId, requestId, { content: prompt, references, selectedNodeIds }, resume);
      trace.event('agent.run_claimed', { runId: ticket.run.id, status: ticket.run.status });
      let holdId: string | undefined;
      let settled = false;
      let executed = false;
      try {
        if (ticket.run.deliveredAt && TERMINAL_STATUSES.includes(ticket.run.status)) {
          yield { event: 'done', data: await this.get(userId, canvasId, conversationId) };
          return;
        }
        // Reserve and attach billing atomically; a process crash cannot orphan a
        // charged operation or cause a resumed request to reserve twice.
        trace.stage('credits.reserve', { runId: ticket.run.id, model: CHAT_MODEL });
        holdId = await this.prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM canvases WHERE id = ${canvasId} FOR UPDATE`;
          if (!await tx.canvasAgentLease.findFirst({ where: { runId: ticket.run.id, token: ticket.token, expiresAt: { gt: new Date() } } })) throw new ConflictException('任务执行权已失效');
          const existing = ticket.run.holdId ? await tx.creditHold.findUnique({ where: { id: ticket.run.holdId } }) : null;
          if (existing?.status === 'held' && (!existing.expiresAt || existing.expiresAt > new Date())) return existing.id;
          if (existing?.status === 'held') await this.credits.settle(tx, existing.id, false);
          await this.credits.assertConcurrentLimit(tx, userId);
          trace.stage('credits.quote', { model: CHAT_MODEL });
          const quote = await this.credits.quote({ kind: 'chat', model: CHAT_MODEL }, tx);
          trace.stage('credits.hold', { credits: quote.total, priceId: quote.priceId });
          const hold = await this.credits.reserve(tx, userId, quote.total, `agent:${ticket.run.id}:${ticket.token}`, 'Agent 对话', conversationId, new Date(Date.now() + 30 * 60000));
          await tx.canvasAgentRun.update({ where: { id: ticket.run.id }, data: { holdId: hold.id } });
          return hold.id;
        });
        let answer = '';
        executed = true;
        trace.stage('agent.execute', { runId: ticket.run.id });
        for await (const event of this.agent.execute(ticket, messages, CHAT_MODEL, signal)) {
          if (event.event === 'delta') answer += String(event.data.text ?? '');
          yield event;
        }
        answer = answer.trim();
        if (!answer || signal.aborted) throw new Error('Generation was interrupted');
        const title = history.length === 0 ? [...readablePrompt(prompt).replace(/\s+/g, ' ')].slice(0, 24).join('') || '新对话' : conversation.title;
        trace.stage('delivery.commit');
        await this.prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM canvases WHERE id = ${canvasId} FOR UPDATE`;
          if (!await tx.canvasAgentLease.findFirst({ where: { runId: ticket.run.id, token: ticket.token, expiresAt: { gt: new Date() } } })) throw new ConflictException('任务执行权已失效');
          await tx.canvasChatMessage.upsert({ where: { runId_role: { runId: ticket.run.id, role: 'user' } }, create: { conversationId, runId: ticket.run.id, role: 'user', content: prompt, references: resolvedReferences as Prisma.InputJsonValue }, update: { content: prompt, references: resolvedReferences as Prisma.InputJsonValue } });
          await tx.canvasChatMessage.upsert({ where: { runId_role: { runId: ticket.run.id, role: 'assistant' } }, create: { conversationId, runId: ticket.run.id, role: 'assistant', content: answer }, update: { content: answer } });
          const billing = await this.credits.settle(tx, holdId!, true);
          if (billing.status !== 'captured') throw new BadRequestException('对话已超时，积分已退还，请恢复任务');
          await tx.canvasAgentRun.update({ where: { id: ticket.run.id }, data: { deliveredAt: new Date() } });
          await tx.canvasConversation.update({ where: { id: conversationId }, data: { title } });
        });
        settled = true;
        trace.stage('delivery.read');
        yield { event: 'done', data: await this.get(userId, canvasId, conversationId) };
        trace.stage('delivery.completed');
      } catch (error) {
        // Capture the original failure before refund/lease cleanup can also fail.
        trace.failure(error, 'agent.execution_or_billing_failed');
        throw error;
      } finally {
        try {
          if (!settled && holdId) {
            trace.event('agent.credits_refund');
            try { await this.credits.finishOperation(holdId, false); }
            catch (error) { trace.failure(error, 'agent.refund_failed'); throw error; }
          }
          if (!executed && !ticket.run.deliveredAt) {
            try { await this.agent.store.update(ticket, { status: 'failed', errorCode: 'BILLING_FAILED', error: '对话积分预留失败' }); }
            catch (error) { trace.failure(error, 'agent.failure_checkpoint_failed'); throw error; }
          }
        } finally {
          try { await this.agent.store.release(ticket); }
          catch (error) { trace.failure(error, 'agent.lease_release_failed'); throw error; }
        }
      }
    } catch (error) { trace.failure(error); throw error; }
  }

  /**
   * 解析引用中的图片节点为 base64 data URL（最多 MAX_REFERENCE_IMAGES 张）。
   * 素材 ID 在 sendStream 中校验；无素材 ID 的节点 URL 也必须属于当前用户。
   * 读取失败的跳过，不阻断回复。
   */
  private async resolveReferenceImages(userId: string, references: CanvasChatReference[]): Promise<string[]> {
    const storageDir = this.config.get('STORAGE_DIR', { infer: true });
    const imageRefs = references
      .filter((reference) => reference.kind === 'image' && reference.url)
      .slice(0, MAX_REFERENCE_IMAGES);
    const images: string[] = [];
    for (const reference of imageRefs) {
      const dataUrl = await readLocalImageAsDataUrl(storageDir, reference.url!, userId);
      if (dataUrl) images.push(dataUrl);
    }
    return images;
  }

}
