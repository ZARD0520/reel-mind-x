import type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  LlmProvider,
  LlmProviderConfig,
} from '../types';
import { LlmError } from '../types';

/** GLM chat/completions 响应体（仅取用到的字段） */
interface GlmResponse {
  model?: string;
  choices?: Array<{
    message?: { role: string; content: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}


/**
 * 智谱 GLM-4.5 provider（OpenAI-compatible API）。
 * API 文档：https://docs.bigmodel.cn/cn/guide/models/text/glm-4.5
 */
export class GlmProvider implements LlmProvider {
  readonly name = 'glm';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: LlmProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://open.bigmodel.cn/api/paas/v4';
    this.model = config.model ?? 'glm-4-flash';
  }

  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<ChatResult> {
    const url = `${this.baseUrl}/chat/completions`;
    const model = options.model ?? this.model;

    const body = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '无法读取响应');
        throw new LlmError(
          `GLM API 调用失败 (${response.status}): ${text}`,
          response.status,
        );
      }

      const data = (await response.json()) as GlmResponse;
      const choice = data.choices?.[0];
      if (!choice?.message?.content) {
        throw new LlmError('GLM 返回格式异常：缺少 message.content');
      }

      return {
        text: choice.message.content,
        model: data.model ?? model,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
      };
    } catch (err) {
      if (err instanceof LlmError) throw err;
      throw new LlmError('GLM API 网络错误', undefined, err);
    }
  }
}
