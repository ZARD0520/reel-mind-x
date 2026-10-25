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
 * 已知模型的单次输出 token 上限：智谱服务端会拒绝超限请求（400）。
 * 未列出的模型不做钳制，由服务端自行校验。
 */
const OUTPUT_TOKEN_CEILINGS: Record<string, number> = {
  'glm-4v-flash': 1024,
};

function clampMaxTokens(model: string, maxTokens?: number): number | undefined {
  const ceiling = OUTPUT_TOKEN_CEILINGS[model];
  if (maxTokens === undefined) return undefined;
  return ceiling ? Math.min(maxTokens, ceiling) : maxTokens;
}


/**
 * 智谱 GLM provider（OpenAI-compatible API）。
 * 文本模型文档：https://docs.bigmodel.cn/cn/guide/models/text/glm-4.5
 * 视觉模型（GLM-4V 系列）文档：https://docs.bigmodel.cn/cn/guide/models/free/glm-4v-flash
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
      messages: messages.map((m) => ({
        role: m.role,
        // 视觉模型（GLM-4V 系列）要求 content 为 text/image_url 分段数组
        content: m.images?.length
          ? [
              { type: 'text', text: m.content },
              ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
            ]
          : m.content,
      })),
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(clampMaxTokens(model, options.maxTokens) !== undefined && {
        max_tokens: clampMaxTokens(model, options.maxTokens),
      }),
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
        // 视觉思考模型（GLM-4.1V-Thinking）会用 box 标记包裹最终答案，剥离掉
        text: choice.message.content.replace(/<\|begin_of_box\|>|<\|end_of_box\|>/g, ''),
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
          messages: messages.map((m) => ({
            role: m.role,
            // 与 chat 一致：视觉模型（GLM-4V 系列）要求 content 为 text/image_url 分段数组
            content: m.images?.length
              ? [
                  { type: 'text', text: m.content },
                  ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
                ]
              : m.content,
          })),
          stream: true,
          ...(options.temperature !== undefined && { temperature: options.temperature }),
          ...(clampMaxTokens(model, options.maxTokens) !== undefined && {
            max_tokens: clampMaxTokens(model, options.maxTokens),
          }),
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
