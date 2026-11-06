import type {
  ChatMessage,
  ChatOptions,
  ChatResult,
  ChatStreamEvent,
  ChatToolCall,
  LlmProvider,
  LlmProviderConfig,
} from '../types';
import { LlmError } from '../types';
import { SseDecoder } from '@reel/contracts';
import { streamPromptTools } from './prompt-tools';

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
  'glm-4.1v-thinking-flash': 32768,
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
    for await (const event of this.chatStreamEvents(messages, options)) {
      if (event.type === 'text') yield event.text;
    }
  }

  async *chatStreamEvents(messages: ChatMessage[], options: ChatOptions = {}): AsyncIterable<ChatStreamEvent> {
    const model = options.model ?? this.model;
    if (model === 'glm-4.1v-thinking-flash' && options.tools?.length) {
      yield* streamPromptTools((history, params) => this.chatStreamEvents(history, params), messages, options);
      return;
    }
    if (options.maxEstimatedInputTokens !== undefined) {
      const textMessages = messages.map(({ images: _images, ...message }) => message);
      const estimated = Buffer.byteLength(JSON.stringify({ messages: textMessages, tools: options.tools }), 'utf8') + 2048 * messages.reduce((n, m) => n + (m.images?.length ?? 0), 0);
      if (estimated > options.maxEstimatedInputTokens) throw new LlmError('本轮模型输入超出上下文预算', undefined, { code: 'CONTEXT_BUDGET', estimatedInputTokens: estimated, limit: options.maxEstimatedInputTokens });
    }
    if (options.requestBudget) {
      const requested = clampMaxTokens(model, options.maxTokens) ?? 4096;
      if (options.requestBudget.remainingRequests <= 0 || options.requestBudget.remainingOutputTokens < requested) throw new LlmError('本轮模型请求预算已耗尽', undefined, { code: 'REQUEST_BUDGET' });
      options.requestBudget.remainingRequests--;
      options.requestBudget.remainingOutputTokens -= requested;
    }
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
            ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
            ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
            // 与 chat 一致：视觉模型（GLM-4V 系列）要求 content 为 text/image_url 分段数组
            content: m.images?.length
              ? [
                  { type: 'text', text: m.content },
                  ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
                ]
              : m.content,
          })),
          stream: true,
          ...(options.tools?.length ? { tools: options.tools, tool_choice: 'auto' } : {}),
          ...(model === 'glm-4.6v-flash' || (options.tools?.length && model !== 'glm-4.1v-thinking-flash')
            ? { thinking: { type: 'disabled' } } : {}),
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
    let reasoningCharacters = 0;
    let contentCharacters = 0;
    let pendingText = '';
    const calls = new Map<number, ChatToolCall>();
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
          let data: { usage?: GlmResponse['usage']; choices?: Array<{ finish_reason?: string; delta?: { content?: string; reasoning_content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> } }>; error?: { message?: string } };
          try {
            data = JSON.parse(event.data) as typeof data;
          } catch {
            throw new LlmError('GLM 流式响应格式异常');
          }
          if (data.error) throw new LlmError(data.error.message || 'GLM 流式响应失败');
          const content = data.choices?.[0]?.delta?.content;
          reasoningCharacters += data.choices?.[0]?.delta?.reasoning_content?.length ?? 0;
          contentCharacters += content?.length ?? 0;
          // A native tool candidate may need protocol repair. Do not expose its
          // accompanying text until we know which response will be accepted.
          if (content) {
            if (options.tools?.length) pendingText += content;
            else yield { type: 'text', text: content };
          }
          for (const part of data.choices?.[0]?.delta?.tool_calls ?? []) {
            if (!Number.isInteger(part.index) || part.index < 0 || part.index >= 20) throw new LlmError('模型返回的工具调用数量或索引无效');
            const call = calls.get(part.index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
            if (part.id) call.id = part.id;
            if (part.function?.name) call.function.name += part.function.name;
            if (call.function.name.length > 100) throw new LlmError('模型返回的工具名称无效');
            if (part.function?.arguments) call.function.arguments += part.function.arguments;
            if (call.function.arguments.length > 100000) throw new LlmError('工具参数超出大小限制');
            calls.set(part.index, call);
          }
          if (data.choices?.[0]?.finish_reason === 'length') throw new LlmError('模型输出达到长度限制，请缩小本次任务范围', undefined, {
            code: 'OUTPUT_TOKEN_LIMIT', model, finishReason: 'length',
            maxTokens: clampMaxTokens(model, options.maxTokens),
            reasoningCharacters, contentCharacters, usage: data.usage,
          });
        }
        if (done) break;
      }
      if (!finished) throw new LlmError('GLM 流式响应中断');
      if (calls.size) {
        const complete = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)
          .filter(call => call.function.name || call.function.arguments.trim());
        // Some streams include empty tool-call scaffolding in their final chunk.
        // It carries no executable request and must not turn a final reply into a failure.
        if (!options.tools?.length && complete.some(call => !call.id || !call.function.name)) throw new LlmError('模型返回的工具调用不完整', undefined, { calls: complete });
        const invalid = complete.find(call => {
          if (options.tools?.length && (!call.id || !call.function.name || !options.tools.some(tool => tool.function.name === call.function.name))) return true;
          const schema = options.tools?.find(tool => tool.function.name === call.function.name)?.function.parameters;
          if (!schema || !Array.isArray(schema.required) || !schema.required.length) return false;
          try {
            const args: unknown = JSON.parse(call.function.arguments);
            return !args || typeof args !== 'object' || Array.isArray(args) || schema.required.some(key => !Object.hasOwn(args, String(key)));
          } catch { return true; }
        });
        if (invalid) {
          // Some GLM native responses name the tool but return {} repeatedly.
          // Repair this unexecuted candidate with the explicit JSON protocol,
          // preserving all successful results and the latest user request.
          await reader.cancel().catch(() => undefined);
          yield* streamPromptTools((history, params) => this.chatStreamEvents(history, params), [
            ...messages,
            { role: 'system', content: `上一条原生工具候选 ${invalid.function.name} 缺少必填参数，已拒绝且未执行。请根据已有上下文和工具定义补全全部必填参数，遵守原始系统要求。` },
          ], { ...options, model });
          return;
        }
        if (complete.length) {
          yield { type: 'tool_calls', calls: complete };
          return;
        }
      }
      if (pendingText) yield { type: 'text', text: pendingText };
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }
}
