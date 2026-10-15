import { Injectable, NotFoundException } from '@nestjs/common';
import type { ChatMessage } from '@reel/llm';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';

const CHAT_MODEL = 'glm-4-flash';

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
      select: { id: true, role: true, content: true, createdAt: true },
    });
    return { ...conversation, messages };
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

  async *sendStream(userId: string, canvasId: string, conversationId: string, content: string, signal: AbortSignal) {
    const conversation = await this.requireConversation(userId, canvasId, conversationId);
    const history = await this.prisma.canvasChatMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { role: true, content: true },
    });
    const prompt = content.trim();
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是一个协助用户进行创意构思和内容创作的助手。根据用户的问题自然、清晰地回答。' },
      ...history.map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content })),
      { role: 'user', content: prompt },
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
      await tx.canvasChatMessage.create({ data: { conversationId, role: 'user', content: prompt } });
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
