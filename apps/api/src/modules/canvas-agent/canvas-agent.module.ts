import { Module } from '@nestjs/common';
import { CanvasToolsService } from './canvas-tools.service';
import { CanvasMcpService } from './canvas-mcp.service';
import { CanvasMcpController } from './canvas-mcp.controller';
import { CanvasAgentService } from './canvas-agent.service';

@Module({ controllers: [CanvasMcpController], providers: [CanvasToolsService, CanvasMcpService, CanvasAgentService], exports: [CanvasAgentService] })
export class CanvasAgentModule {}
