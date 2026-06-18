import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { Project } from '@reel/contracts';
import { CreateProjectDto, UpdateProjectDto } from './projects.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  create(@Body() dto: CreateProjectDto): Promise<Project> {
    return this.projects.create(dto);
  }

  @Get()
  list(): Promise<Project[]> {
    return this.projects.list();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Project> {
    return this.projects.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<Project> {
    return this.projects.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.projects.remove(id);
  }
}
