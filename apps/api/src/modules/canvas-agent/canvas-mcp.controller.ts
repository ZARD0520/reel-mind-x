import { All, Body, Controller, Param, ParseUUIDPipe, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { CanvasMcpService } from './canvas-mcp.service';
import { CanvasToolsService } from './canvas-tools.service';

@Controller('canvases/:canvasId/mcp')
@UseGuards(AuthGuard)
export class CanvasMcpController {
  constructor(private readonly mcp: CanvasMcpService, private readonly tools: CanvasToolsService, private readonly config: ConfigService) {}

  @All()
  async handle(@CurrentUser() user: AuthUser, @Param('canvasId', ParseUUIDPipe) canvasId: string,
    @Req() request: IncomingMessage, @Res() response: ServerResponse, @Body() body: unknown) {
    const scope = { userId: user.id, canvasId, selectedNodeIds: [] };
    await this.tools.read(scope);
    const server = this.mcp.createServer(scope);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    // HTTP uses the same cookie authentication as the app. Reject cross-origin browser writes.
    if (request.headers.origin && request.headers.origin !== this.config.get<string>('CORS_ORIGIN') && request.headers.origin !== `http://${request.headers.host}` && request.headers.origin !== `https://${request.headers.host}`) {
      response.statusCode = 403;
      response.end('Cross-origin MCP requests are not allowed');
      return;
    }
    response.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  }
}
