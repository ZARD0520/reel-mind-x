import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QueueNames } from './render.constants';
import { RenderController } from './render.controller';
import { RenderProcessor } from './render.processor';
import { RenderService } from './render.service';

@Module({
  imports: [BullModule.registerQueue({ name: QueueNames.RENDER })],
  controllers: [RenderController],
  providers: [RenderService, RenderProcessor],
  exports: [RenderService],
})
export class RenderModule {}
