import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CreateAiMixSchema, type AiMixJob } from '@reel/contracts';
import { createZodDto } from 'nestjs-zod';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { AiMixService } from './ai-mix.service';

class CreateAiMixDto extends createZodDto(CreateAiMixSchema) {}

@Controller('ai-mix')
@UseGuards(AuthGuard)
export class AiMixController {
  constructor(private readonly aiMix: AiMixService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAiMixDto): Promise<AiMixJob> {
    return this.aiMix.create(user.id, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): AiMixJob {
    return this.aiMix.findOne(user.id, id);
  }
}
