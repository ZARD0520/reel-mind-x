import { Global, Module } from '@nestjs/common';
import { LlmService } from './llm.service';

/**
 * LLM 全局模块：任何 feature 都可 inject LlmService。
 * @Global 装饰器使得 text-gen/ai-mix 等无需 import LlmModule。
 */
@Global()
@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
