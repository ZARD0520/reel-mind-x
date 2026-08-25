import { Module } from '@nestjs/common';
import { CanvasesController } from './canvases.controller';
import { CanvasesService } from './canvases.service';

@Module({
  controllers: [CanvasesController],
  providers: [CanvasesService],
})
export class CanvasesModule {}
