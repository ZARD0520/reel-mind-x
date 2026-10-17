import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { CreateGenerationTaskSchema } from '@reel/contracts';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { GenerationTasksService } from './generation-tasks.service';

class CreateTaskDto extends createZodDto(CreateGenerationTaskSchema) {}

@Controller('generation-tasks')
@UseGuards(AuthGuard)
export class GenerationTasksController {
  constructor(private readonly service: GenerationTasksService) {}
  @Post() create(@CurrentUser() user: AuthUser, @Body() input: CreateTaskDto) {
    return this.service.create(user.id, input);
  }
  @Get() list(@CurrentUser() user: AuthUser, @Query('canvasId', ParseUUIDPipe) canvasId: string) {
    return this.service.list(user.id, canvasId);
  }
  @Get(':id') get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(user.id, id);
  }
  @Post(':id/resume') resume(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.resume(user.id, id);
  }
}
