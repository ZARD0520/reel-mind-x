import { Module } from '@nestjs/common';
import { CanvasToolsService } from './canvas-tools.service';
import { CanvasMcpService } from './canvas-mcp.service';
import { CanvasMcpController } from './canvas-mcp.controller';
import { CanvasAgentService } from './canvas-agent.service';
import { GenerationTasksModule } from '../generation-tasks/generation-tasks.module';
import { CanvasImageToolsService } from './canvas-image-tools.service';
import { CanvasGenerationRecovery } from './canvas-generation-recovery.service';

@Module({ imports: [GenerationTasksModule], controllers: [CanvasMcpController], providers: [CanvasToolsService, CanvasMcpService, CanvasAgentService, CanvasImageToolsService, CanvasGenerationRecovery], exports: [CanvasAgentService] })
export class CanvasAgentModule {}
