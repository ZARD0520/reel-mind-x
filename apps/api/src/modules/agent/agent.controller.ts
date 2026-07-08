import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AgentService } from './agent.service';

@Controller('agent')
@UseGuards(AuthGuard)
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('run')
  async run(@Body() body: { prompt: string }): Promise<{ jobId: string }> {
    const jobId = await this.agentService.enqueueRun(body);
    return { jobId };
  }
}
