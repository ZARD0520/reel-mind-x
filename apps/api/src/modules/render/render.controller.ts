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
import { CreateRenderSchema, type RenderJob } from '@reel/contracts';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { RenderService } from './render.service';

class CreateRenderDto extends createZodDto(CreateRenderSchema) {}

@Controller('render')
@UseGuards(AuthGuard)
export class RenderController {
  constructor(private readonly render: RenderService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRenderDto): Promise<RenderJob> {
    return this.render.enqueue(user.id, dto);
  }

  @Get()
  findLatest(
    @CurrentUser() user: AuthUser,
    @Query('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<RenderJob | null> {
    return this.render.findLatest(user.id, projectId);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RenderJob> {
    return this.render.cancel(user.id, id);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RenderJob> {
    return this.render.findOne(user.id, id);
  }
}
