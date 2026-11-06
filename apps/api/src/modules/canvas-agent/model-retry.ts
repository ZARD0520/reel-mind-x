import { LlmError, type ChatMessage, type ChatOptions, type ChatStreamEvent } from '@reel/llm';
import type { LlmService } from '../llm/llm.service';

export const PRIMARY_AGENT_MODEL = 'glm-4.6v-flash';
export const FALLBACK_AGENT_MODEL = 'glm-4.1v-thinking-flash';

/** Switch only the current model request, before any output or tool execution. */
export async function* streamAgentModel(
  llm: Pick<LlmService, 'chatStreamEvents'>,
  messages: ChatMessage[],
  options: ChatOptions,
  onFallback: (model: string) => void,
): AsyncIterable<ChatStreamEvent> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let receivedOutput = false;
    try {
      const activeModel = attempt === 0 ? options.model : FALLBACK_AGENT_MODEL;
      for await (const event of llm.chatStreamEvents(messages, { ...options, model: activeModel, ...(activeModel === FALLBACK_AGENT_MODEL ? { maxTokens: Math.max(16384, options.maxTokens ?? 0) } : {}) })) {
        receivedOutput = true;
        yield event;
      }
      return;
    } catch (error) {
      if (!(error instanceof LlmError) || error.status !== 429 || receivedOutput || attempt !== 0 || options.model !== PRIMARY_AGENT_MODEL || options.signal?.aborted) throw error;
      onFallback(FALLBACK_AGENT_MODEL);
    }
  }
}

export async function chatAgentModel(llm: Pick<LlmService, 'chat'>, messages: ChatMessage[], options: ChatOptions) {
  try { return await llm.chat(messages, options); }
  catch (error) {
    if (!(error instanceof LlmError) || error.status !== 429 || options.model !== PRIMARY_AGENT_MODEL || options.signal?.aborted) throw error;
    return llm.chat(messages, { ...options, model: FALLBACK_AGENT_MODEL });
  }
}
