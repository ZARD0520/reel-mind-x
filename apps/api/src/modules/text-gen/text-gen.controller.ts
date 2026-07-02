import { Body, Controller, Post } from '@nestjs/common';
import type { GeneratedText } from '@reel/contracts';
import { GenerateTextDto } from './text-gen.dto';
import { TextGenService } from './text-gen.service';

/**
 * AI 文本生成接口。controller 保持薄，只做接收与响应。
 */
@Controller('text-gen')
export class TextGenController {
  constructor(private readonly textGen: TextGenService) {}

  /** 同步生成一段受字数限制的文案 */
  @Post('generate')
  async generate(@Body() dto: GenerateTextDto): Promise<GeneratedText> {
    return this.textGen.generate(dto);
  }
}
