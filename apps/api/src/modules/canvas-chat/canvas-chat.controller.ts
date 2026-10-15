import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RenameCanvasConversationDto, SendCanvasMessageDto } from './canvas-chat.dto';
import { CanvasChatService } from './canvas-chat.service';

@Controller('canvases/:canvasId/conversations')
@UseGuards(AuthGuard)
export class CanvasChatController {
  constructor(private readonly chat: CanvasChatService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('canvasId', ParseUUIDPipe) canvasId: string) {
    return this.chat.list(user.id, canvasId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Param('canvasId', ParseUUIDPipe) canvasId: string) {
    return this.chat.create(user.id, canvasId);
  }

  @Get(':conversationId')
  get(
    @CurrentUser() user: AuthUser,
    @Param('canvasId', ParseUUIDPipe) canvasId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    return this.chat.get(user.id, canvasId, conversationId);
  }

  @Patch(':conversationId')
  rename(
    @CurrentUser() user: AuthUser,
    @Param('canvasId', ParseUUIDPipe) canvasId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: RenameCanvasConversationDto,
  ) {
    return this.chat.rename(user.id, canvasId, conversationId, dto.title);
  }

  @Delete(':conversationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('canvasId', ParseUUIDPipe) canvasId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<void> {
    await this.chat.remove(user.id, canvasId, conversationId);
  }

  @Post(':conversationId/messages')
  async send(
    @CurrentUser() user: AuthUser,
    @Param('canvasId', ParseUUIDPipe) canvasId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: SendCanvasMessageDto,
    @Res() response: ServerResponse,
  ): Promise<void> {
    await this.chat.assertConversation(user.id, canvasId, conversationId);
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();

    const abort = new AbortController();
    response.on('close', () => abort.abort());
    try {
      for await (const item of this.chat.sendStream(user.id, canvasId, conversationId, dto.content, abort.signal)) {
        if (response.writableEnded || abort.signal.aborted) break;
        response.write(`event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`);
      }
    } catch {
      if (!response.writableEnded && !abort.signal.aborted) {
        response.write(`event: error\ndata: ${JSON.stringify({ message: '生成失败，请重试' })}\n\n`);
      }
    } finally {
      if (!response.writableEnded) response.end();
    }
  }
}
