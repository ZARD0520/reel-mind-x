import { Body, ConflictException, Controller, Delete, Get, HttpCode, HttpStatus, Logger, Param, ParseUUIDPipe, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { chatErrorMessage } from '@reel/contracts';
import type { ServerResponse } from 'node:http';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RenameCanvasConversationDto, SendCanvasMessageDto } from './canvas-chat.dto';
import { CanvasChatService } from './canvas-chat.service';
import { createAgentDiagnostics } from '../canvas-agent/agent-diagnostics';

@Controller('canvases/:canvasId/conversations')
@UseGuards(AuthGuard)
export class CanvasChatController {
  private readonly logger = new Logger(CanvasChatController.name);
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
    const requestId = dto.requestId ?? randomUUID();
    const trace = createAgentDiagnostics({ requestId, canvasId, conversationId }, this.logger);
    trace.stage('request.received', { contentCharacters: dto.content.length, referenceCount: dto.references.length, selectedNodeCount: dto.selectedNodeIds.length, resume: !!dto.resume });
    try { await this.chat.assertConversation(user.id, canvasId, conversationId); }
    catch (error) { trace.failure(error, 'agent.request_rejected'); throw error; }
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.setHeader('X-Agent-Request-Id', requestId);
    response.flushHeaders();

    const abort = new AbortController();
    response.on('close', () => {
      if (!response.writableEnded) trace.event('agent.disconnected');
      abort.abort();
    });
    try {
      trace.stage('request.streaming');
      for await (const item of this.chat.sendStream(user.id, canvasId, conversationId, dto.content, dto.references, abort.signal, dto.selectedNodeIds, requestId, dto.resume)) {
        if (response.writableEnded || abort.signal.aborted) break;
        response.write(`event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`);
      }
      if (!abort.signal.aborted) trace.stage('request.completed');
    } catch (error) {
      trace.failure(error, 'Agent chat failed');
      if (!response.writableEnded && !abort.signal.aborted) {
        // A rejected duplicate/concurrent request must not append a fake failed
        // turn or replace the response of the worker that owns the lease.
        if (error instanceof ConflictException) {
          response.write(`event: error\ndata: ${JSON.stringify({ message: chatErrorMessage(error) })}\n\n`);
          return;
        }
        const message = chatErrorMessage(error);
        try {
          const conversation = await this.chat.saveErrorTurn(user.id, canvasId, conversationId, dto.content, dto.references, error, requestId);
          if (!response.writableEnded && !abort.signal.aborted) {
            response.write(`event: replace\ndata: ${JSON.stringify({ text: message })}\n\n`);
            response.write(`event: done\ndata: ${JSON.stringify(conversation)}\n\n`);
          }
        } catch (saveError) {
          trace.failure(saveError, 'agent.error_delivery_failed');
          if (!response.writableEnded && !abort.signal.aborted) response.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
        }
      }
    } finally {
      trace.event('agent.request_closed', { aborted: abort.signal.aborted });
      if (!response.writableEnded) response.end();
    }
  }

  @Post(':conversationId/runs/:runId/resume')
  async resume(@CurrentUser() user: AuthUser, @Param('canvasId', ParseUUIDPipe) canvasId: string,
    @Param('conversationId', ParseUUIDPipe) conversationId: string, @Param('runId', ParseUUIDPipe) runId: string,
    @Res() response: ServerResponse): Promise<void> {
    const input = await this.chat.resumeInput(user.id, canvasId, conversationId, runId);
    return this.send(user, canvasId, conversationId, input, response);
  }
}
