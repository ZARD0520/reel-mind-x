import { Module } from '@nestjs/common';
import { TextGenController } from './text-gen.controller';
import { TextGenService } from './text-gen.service';

/**
 * AI 文本生成 feature 模块。
 * 依赖全局 LlmModule 提供的 LlmService（无需在此 import）。
 */
@Module({
  controllers: [TextGenController],
  providers: [TextGenService],
})
export class TextGenModule {}
