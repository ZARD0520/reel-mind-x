import { Module } from '@nestjs/common';
import { GenerationTasksModule } from './generation-tasks.module';
import { GenerationTasksProcessor } from './generation-tasks.processor';
import { TextGenModule } from '../text-gen/text-gen.module';

@Module({ imports: [GenerationTasksModule, TextGenModule], providers: [GenerationTasksProcessor] })
export class GenerationTasksWorkerModule {}
