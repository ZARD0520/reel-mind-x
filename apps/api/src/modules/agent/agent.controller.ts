import { Body, Controller, Post } from '@nestjs/common';
import { AgentService } from './agent.service';

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('run')
  async run(@Body() body: { prompt: string }): Promise<{ jobId: string }> {
    const jobId = await this.agentService.enqueueRun(body);
    return { jobId };
  }
}
