import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { GeneratedText } from '@reel/contracts';
import { AuthGuard } from '../auth/auth.guard';
import { GenerateTextDto } from './text-gen.dto';
import { TextGenService } from './text-gen.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { GenerationTasksService } from '../generation-tasks/generation-tasks.service';
import { randomUUID } from 'crypto';
import { CreditsService } from '../credits/credits.service';

/**
 * AI 文本生成接口。controller 保持薄，只做接收与响应。
 */
@Controller('text-gen')
@UseGuards(AuthGuard)
export class TextGenController {
  constructor(private readonly textGen: TextGenService, private readonly tasks: GenerationTasksService, private readonly credits: CreditsService) {}

  /** 同步生成一段受字数限制的文案 */
  @Post('generate')
  async generate(@Body() dto: GenerateTextDto, @CurrentUser() user: AuthUser): Promise<GeneratedText> {
    if (dto.canvasId || dto.projectId) {
      const prompt = dto.prompt ?? [...(dto.messages ?? [])].reverse().find((message) => message.role === 'user')?.content ?? '';
      const task = await this.tasks.create(user.id, { ...dto, prompt, kind: 'text', requestId: dto.requestId ?? randomUUID() });
      return this.tasks.waitForText(user.id, task.id);
    }
    const hold = await this.credits.beginOperation(user.id, { kind: 'text', model: dto.model });
    try {
      const result = await this.textGen.generate(dto, user.id);
      await this.credits.finishOperation(hold.id, true);
      return result;
    } catch (error) {
      await this.credits.finishOperation(hold.id, false);
      throw error;
    }
  }
}
