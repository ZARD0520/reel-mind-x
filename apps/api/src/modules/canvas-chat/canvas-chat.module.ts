import { Module } from '@nestjs/common';
import { CanvasChatController } from './canvas-chat.controller';
import { CanvasChatService } from './canvas-chat.service';
import { CanvasAgentModule } from '../canvas-agent/canvas-agent.module';

@Module({ imports: [CanvasAgentModule], controllers: [CanvasChatController], providers: [CanvasChatService] })
export class CanvasChatModule {}
