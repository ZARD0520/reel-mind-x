/**
 * AI 图像/视频生成抽象层。
 * 与 LLM 分离，因为生成式媒体的 API 模式完全不同（异步任务、轮询、URL 结果）。
 */

/** 生成类型 */
export type GenerationType = 'image' | 'video';

/** 生成参数 */
export interface GenerateOptions {
  /** 提示词 */
  prompt: string;
  /** 图像尺寸（仅图像生成，格式如 "1024x1024"） */
  size?: string;
  /** 视频时长（秒，仅视频生成） */
  duration?: number;
  /** 中断信号 */
  signal?: AbortSignal;
}

/** 生成结果 */
export interface GenerateResult {
  /** 生成内容的临时 URL（智谱返回的 CDN 链接，有效期有限） */
  url: string;
  /** 生成内容类型 */
  type: GenerationType;
  /** 实际使用的模型 */
  model: string;
  /** 提示词（原样返回） */
  prompt: string;
}

/** AI 生成提供商接口 */
export interface AiGenProvider {
  readonly name: string;
  /** 生成图像 */
  generateImage(options: GenerateOptions): Promise<GenerateResult>;
  /** 生成视频 */
  generateVideo(options: GenerateOptions): Promise<GenerateResult>;
}

/** provider 配置 */
export interface AiGenProviderConfig {
  apiKey: string;
  baseUrl?: string;
  imageModel?: string;
  videoModel?: string;
}

/** AI 生成失败时抛出的统一错误 */
export class AiGenError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AiGenError';
  }
}
