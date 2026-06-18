import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QueueNames } from './agent.constants';
import type { RunAgentPayload } from './agent.service';

/**
 * agent 队列处理器。并发可按需在装饰器里配置 { concurrency: N }。
 * 超出重试的任务由 BullMQ 标记 failed，可另接 DLQ 流程。
 */
@Processor(QueueNames.AGENT)
export class AgentProcessor extends WorkerHost {
  private readonly logger = new Logger(AgentProcessor.name);

  async process(job: Job<RunAgentPayload>): Promise<unknown> {
    this.logger.log(`处理 agent 任务 ${job.id}: ${job.data.prompt}`);
    // TODO: 在此接入实际 agent 推理逻辑
    return { ok: true };
  }
}
