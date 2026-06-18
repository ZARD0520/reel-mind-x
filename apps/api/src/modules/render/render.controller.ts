import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { CreateRenderSchema, type RenderJob } from '@reel/contracts';
import { RenderService } from './render.service';

class CreateRenderDto extends createZodDto(CreateRenderSchema) {}

@Controller('render')
export class RenderController {
  constructor(private readonly render: RenderService) {}

  @Post()
  create(@Body() dto: CreateRenderDto): Promise<RenderJob> {
    return this.render.enqueue(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<RenderJob> {
    return this.render.findOne(id);
  }
}
