import { Module } from '@nestjs/common';
import { CanvasChatController } from './canvas-chat.controller';
import { CanvasChatService } from './canvas-chat.service';

@Module({ controllers: [CanvasChatController], providers: [CanvasChatService] })
export class CanvasChatModule {}
