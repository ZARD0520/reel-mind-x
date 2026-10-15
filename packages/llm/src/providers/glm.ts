import type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  LlmProvider,
  LlmProviderConfig,
} from '../types';
import { LlmError } from '../types';
import { SseDecoder } from '@reel/contracts';

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

  async *chatStream(messages: ChatMessage[], options: ChatOptions = {}): AsyncIterable<string> {
    const model = options.model ?? this.model;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: messages.map(({ role, content }) => ({ role, content })),
          stream: true,
          ...(options.temperature !== undefined && { temperature: options.temperature }),
          ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
        }),
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      throw new LlmError('GLM API 网络错误', undefined, error);
    }
    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new LlmError(`GLM API 调用失败 (${response.status}): ${detail}`, response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const sse = new SseDecoder();
    let finished = false;
    try {
      while (!finished) {
        const { done, value } = await reader.read();
        const events = done
          ? [...sse.push(decoder.decode()), ...sse.finish()]
          : sse.push(decoder.decode(value, { stream: true }));
        for (const event of events) {
          if (event.data === '[DONE]') {
            finished = true;
            break;
          }
          let data: { choices?: Array<{ delta?: { content?: string } }>; error?: { message?: string } };
          try {
            data = JSON.parse(event.data) as typeof data;
          } catch {
            throw new LlmError('GLM 流式响应格式异常');
          }
          if (data.error) throw new LlmError(data.error.message || 'GLM 流式响应失败');
          const content = data.choices?.[0]?.delta?.content;
          if (content) yield content;
        }
        if (done) break;
      }
      if (!finished) throw new LlmError('GLM 流式响应中断');
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
}
