import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { JobNames, QueueNames } from './agent.constants';

export interface RunAgentPayload {
  prompt: string;
}

/**
 * 业务逻辑在 service，controller 保持薄。
 * agent 逻辑作为后端的一个 module；耗时任务投递到队列异步处理。
 */
@Injectable()
export class AgentService {
  constructor(@InjectQueue(QueueNames.AGENT) private readonly queue: Queue) {}

  async enqueueRun(payload: RunAgentPayload): Promise<string> {
    const job = await this.queue.add(JobNames.RUN_AGENT, payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
    return job.id ?? '';
  }
}
