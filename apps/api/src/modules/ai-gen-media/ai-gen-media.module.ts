import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QueueNames } from './ai-gen-media.constants';
import { AiGenMediaController } from './ai-gen-media.controller';
import { AiGenMediaProcessor } from './ai-gen-media.processor';
import { AiGenMediaService } from './ai-gen-media.service';

@Module({
  imports: [BullModule.registerQueue({ name: QueueNames.AI_GEN_MEDIA })],
  controllers: [AiGenMediaController],
  providers: [AiGenMediaService, AiGenMediaProcessor],
  exports: [AiGenMediaService],
})
export class AiGenMediaModule {}
