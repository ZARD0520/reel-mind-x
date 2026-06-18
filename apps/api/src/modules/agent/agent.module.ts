import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QueueNames } from './agent.constants';
import { AgentController } from './agent.controller';
import { AgentProcessor } from './agent.processor';
import { AgentService } from './agent.service';

@Module({
  imports: [BullModule.registerQueue({ name: QueueNames.AGENT })],
  controllers: [AgentController],
  providers: [AgentService, AgentProcessor],
  exports: [AgentService],
})
export class AgentModule {}
