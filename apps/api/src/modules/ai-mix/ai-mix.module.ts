import { Module } from '@nestjs/common';
import { AiMixController } from './ai-mix.controller';
import { AiMixService } from './ai-mix.service';

@Module({
  controllers: [AiMixController],
  providers: [AiMixService],
  exports: [AiMixService],
})
export class AiMixModule {}
