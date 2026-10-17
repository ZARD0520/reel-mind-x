import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { GENERATION_QUEUE, GenerationTasksService } from './generation-tasks.service';
import { GenerationTasksController } from './generation-tasks.controller';

@Module({
  imports: [BullModule.registerQueue({ name: GENERATION_QUEUE })],
  providers: [GenerationTasksService],
  controllers: [GenerationTasksController],
  exports: [GenerationTasksService, BullModule],
})
export class GenerationTasksModule {}
