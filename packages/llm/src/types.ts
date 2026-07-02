/**
 * LLM 提供商抽象层：定义与具体厂商无关的统一接口。
 * 新增模型（如 OpenAI、通义、DeepSeek）只需实现 LlmProvider，
 * 上层业务代码无需改动。
 */

/** 对话角色 */
export type ChatRole = 'system' | 'user' | 'assistant';

/** 单条对话消息 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** 生成参数（各 provider 自行映射到厂商字段） */
export interface ChatOptions {
  /** 采样温度 0-1，越高越随机 */
  temperature?: number;
  /** 生成的最大 token 数 */
  maxTokens?: number;
  /** 覆盖 provider 默认模型 */
  model?: string;
  /** 中断信号 */
  signal?: AbortSignal;
}

/** token 消耗统计 */
export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** 生成结果 */
export interface ChatResult {
  /** 生成的文本内容 */
  text: string;
  /** 实际使用的模型名 */
  model: string;
  /** token 用量（部分 provider 可能不返回） */
  usage?: ChatUsage;
}

/**
 * LLM 提供商统一接口。
 * 每个厂商实现一次，业务侧只依赖该接口。
 */
export interface LlmProvider {
  /** 提供商标识，如 'glm' */
  readonly name: string;
  /** 发起一次对话补全 */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
}

/** provider 初始化配置 */
export interface LlmProviderConfig {
  /** API 密钥 */
  apiKey: string;
  /** API 基地址（可选，走 provider 默认） */
  baseUrl?: string;
  /** 默认模型名（可选，走 provider 默认） */
  model?: string;
}

/** 调用 LLM 失败时抛出的统一错误 */
export class LlmError extends Error {
  constructor(
    message: string,
    /** 上游 HTTP 状态码（若有） */
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
