import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CreateAiMixSchema, type AiMixJob } from '@reel/contracts';
import { createZodDto } from 'nestjs-zod';
import { AiMixService } from './ai-mix.service';

class CreateAiMixDto extends createZodDto(CreateAiMixSchema) {}

@Controller('ai-mix')
export class AiMixController {
  constructor(private readonly aiMix: AiMixService) {}

  @Post()
  create(@Body() dto: CreateAiMixDto): Promise<AiMixJob> {
    return this.aiMix.create(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): AiMixJob {
    return this.aiMix.findOne(id);
  }
}
