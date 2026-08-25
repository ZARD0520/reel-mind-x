import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import type { Canvas } from '@reel/contracts';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { CanvasesService } from './canvases.service';
import { CreateCanvasDto, UpdateCanvasDto } from './canvases.dto';

@Controller('canvases')
@UseGuards(AuthGuard)
export class CanvasesController {
  constructor(private readonly canvases: CanvasesService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCanvasDto): Promise<Canvas> {
    return this.canvases.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<Canvas[]> {
    return this.canvases.list(user.id);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<Canvas> {
    return this.canvases.findOne(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCanvasDto,
  ): Promise<Canvas> {
    return this.canvases.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.canvases.remove(user.id, id);
  }
}
