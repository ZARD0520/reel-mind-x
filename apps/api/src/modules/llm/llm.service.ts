import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GlmProvider,
  LlmError,
  type ChatMessage,
  type ChatOptions,
  type ChatResult,
  type LlmProvider,
} from '@reel/llm';
import type { Env } from '../../config/env';

/** 支持的 provider 标识；后续新增模型在此扩展 */
export type LlmProviderName = 'glm';

/**
 * LLM 统一服务：对上层业务屏蔽具体厂商。
 * 通过 provider 注册表选择实现，新增模型只需：
 *   1) 在 @reel/llm 里实现 LlmProvider
 *   2) 在本类的 providers 里注册一条
 * 业务代码调用 chat() 不变。
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly providers: Map<LlmProviderName, LlmProvider> = new Map();
  /** 默认 provider（未显式指定时使用） */
  private readonly defaultProvider: LlmProviderName = 'glm';

  constructor(private readonly config: ConfigService<Env, true>) {
    // 注册 GLM。后续新增模型在此追加 this.providers.set(...)。
    this.providers.set(
      'glm',
      new GlmProvider({
        apiKey: this.config.get('GLM_API_KEY', { infer: true }),
        baseUrl: this.config.get('GLM_BASE_URL', { infer: true }),
        model: this.config.get('GLM_MODEL', { infer: true }),
      }),
    );
  }

  /**
   * 发起对话补全。
   * @param provider 指定 provider，省略走默认
   */
  async chat(
    messages: ChatMessage[],
    options?: ChatOptions,
    provider: LlmProviderName = this.defaultProvider,
  ): Promise<ChatResult> {
    const impl = this.providers.get(provider);
    if (!impl) {
      throw new LlmError(`未注册的 LLM provider: ${provider}`);
    }
    this.logger.debug(`调用 LLM provider=${provider}`);
    return impl.chat(messages, options);
  }
}
