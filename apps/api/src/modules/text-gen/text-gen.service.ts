import { Injectable } from '@nestjs/common';
import type { GenerateTextInput, GeneratedText } from '@reel/contracts';
import type { ChatMessage } from '@reel/llm';
import { LlmService } from '../llm/llm.service';

/**
 * AI 文本生成业务逻辑。
 * 约束模型输出字数（默认 100 字），并做兜底截断。
 */
@Injectable()
export class TextGenService {
  constructor(private readonly llm: LlmService) {}

  async generate(input: GenerateTextInput): Promise<GeneratedText> {
    const { prompt, messages: history, maxLength, temperature } = input;

    // system prompt 由后端统一注入，前端只传对话历史（user/assistant）。
    const systemMessage: ChatMessage = {
      role: 'system',
      content:
        `你是短视频文案助手。请根据用户需求生成一段简洁有力的文案，` +
        `严格控制在 ${maxLength} 字以内，不要输出多余解释、标题或引号。` +
        `注意结合上下文（用户可能要求在之前文案基础上调整）。`,
    };

    // 多轮模式用完整历史；单轮模式用单个 prompt。
    const conversation: ChatMessage[] =
      history && history.length > 0
        ? history.map((m) => ({ role: m.role, content: m.content }))
        : [{ role: 'user', content: prompt! }];

    const messages: ChatMessage[] = [systemMessage, ...conversation];

    const result = await this.llm.chat(messages, {
      temperature,
      // 粗略换算：中文约 1.5 token/字，留冗余避免截断在句中
      maxTokens: Math.ceil(maxLength * 2),
    });

    // 兜底：模型可能超出字数限制，硬截断保证契约。
    const text = this.clamp(result.text.trim(), maxLength);

    return {
      text,
      model: result.model,
      usage: result.usage,
    };
  }

  /** 按字符数截断（超出时保留前 maxLength 个字符） */
  private clamp(text: string, maxLength: number): string {
    return [...text].length > maxLength
      ? [...text].slice(0, maxLength).join('')
      : text;
  }
}
