import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ChatMessage } from '@reel/llm';
import type { Prisma } from '@reel/db';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { CanvasChatReferenceSchema, type CanvasChatReference } from './canvas-chat.dto';

const CHAT_MODEL = 'glm-4-flash';

function referenceContext(references: CanvasChatReference[]): string {
  if (!references.length) return '';
  const items = references.map((item, index) => [
    `${index + 1}. ${item.kind === 'text' ? '文本' : item.kind === 'image' ? '图片' : '视频'}节点「${item.title}」`,
    item.content ? `内容：${item.content.slice(0, 4000)}` : '',
    item.prompt ? `生成提示词：${item.prompt}` : '',
    item.description ? `素材信息：${item.description}` : '',
  ].filter(Boolean).join('\n'));
  return `\n\n用户引用的当前画布节点：\n${items.join('\n\n')}`;
}

@Injectable()
export class CanvasChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
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

  async assertConversation(userId: string, canvasId: string, conversationId: string): Promise<void> {
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
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, role: true, content: true, references: true, createdAt: true },
    });
    return { ...conversation, messages: messages.map((message) => ({
      ...message,
      references: CanvasChatReferenceSchema.array().catch([]).parse(message.references),
    })) };
  }

  async rename(userId: string, canvasId: string, conversationId: string, title: string) {
    await this.requireConversation(userId, canvasId, conversationId);
    return this.prisma.canvasConversation.update({
      where: { id: conversationId },
      data: { title },
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
  }

  async remove(userId: string, canvasId: string, conversationId: string): Promise<void> {
    await this.requireConversation(userId, canvasId, conversationId);
    await this.prisma.canvasConversation.delete({ where: { id: conversationId } });
  }

  async *sendStream(userId: string, canvasId: string, conversationId: string, content: string, references: CanvasChatReference[], signal: AbortSignal) {
    const conversation = await this.requireConversation(userId, canvasId, conversationId);
    const history = await this.prisma.canvasChatMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { role: true, content: true, references: true },
    });
    const assetIds = references.flatMap((item) => item.assetId ? [item.assetId] : []);
    let resolvedReferences = references;
    if (assetIds.length) {
      const ownedAssets = await this.prisma.asset.findMany({
        where: { id: { in: assetIds }, userId },
        select: { id: true, name: true, kind: true, prompt: true, width: true, height: true, durationInFrames: true },
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
          description: [asset.name, asset.kind, asset.width && asset.height ? `${asset.width}×${asset.height}` : '', asset.durationInFrames ? `${asset.durationInFrames} 帧` : '', asset.prompt ? `素材提示词：${asset.prompt}` : ''].filter(Boolean).join('；').slice(0, 2000),
        };
      });
    }
    const prompt = content.trim();
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是一个协助用户进行创意构思和内容创作的助手。根据用户的问题自然、清晰地回答。引用的文本节点可直接阅读；图片和视频节点只能依据节点标题、文字内容或生成提示词回答，不要声称看到了画面。' },
      ...history.map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content + referenceContext(CanvasChatReferenceSchema.array().catch([]).parse(message.references)),
      })),
      { role: 'user', content: prompt + referenceContext(resolvedReferences) },
    ];
    let answer = '';
    for await (const text of this.llm.chatStream(messages, { model: CHAT_MODEL, signal })) {
      answer += text;
      yield { event: 'delta', data: { text } };
    }
    answer = answer.trim();
    if (!answer || signal.aborted) throw new Error('Generation was interrupted');
    const firstMessage = history.length === 0;
    const title = firstMessage ? await this.makeTitle(prompt, answer) : conversation.title;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.canvasChatMessage.create({ data: { conversationId, role: 'user', content: prompt, references: resolvedReferences as Prisma.InputJsonValue } });
      await tx.canvasChatMessage.create({ data: { conversationId, role: 'assistant', content: answer } });
      return tx.canvasConversation.update({
        where: { id: conversationId },
        data: { title },
      });
    });
    yield { event: 'done', data: await this.get(userId, canvasId, updated.id) };
  }

  private async makeTitle(prompt: string, answer: string): Promise<string> {
    const fallback = [...prompt.replace(/\s+/g, ' ').trim()].slice(0, 24).join('') || '新对话';
    try {
      const result = await this.llm.chat([
        { role: 'system', content: '请为这次对话写一个简短标题，最多 12 个汉字或 24 个字符。只返回标题，不要引号、标点或解释。' },
        { role: 'user', content: `用户：${prompt}\n助手：${answer.slice(0, 500)}` },
      ], { model: CHAT_MODEL, maxTokens: 48 });
      return [...result.text.trim().replace(/^["“”'「」]+|["“”'「」]+$/g, '')].slice(0, 24).join('') || fallback;
    } catch {
      return fallback;
    }
  }
}
