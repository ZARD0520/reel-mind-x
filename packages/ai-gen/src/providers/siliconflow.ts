import type { AiGenProvider, AiGenProviderConfig, GenerateOptions, GenerateResult } from '../types';
import { AiGenError } from '../types';

export class SiliconFlowAiGenProvider implements AiGenProvider {
  readonly name = 'siliconflow';
  constructor(private readonly config: AiGenProviderConfig) {}

  async generateImage(options: GenerateOptions): Promise<GenerateResult> {
    if (!this.config.apiKey) throw new AiGenError('未配置硅基流动 API Key', 400, undefined, 'rejected');
    const model = options.model ?? this.config.imageModel ?? 'Kwai-Kolors/Kolors';
    const size = options.size ?? '1024x1024';
    if ((options.imageUrls?.length ?? 0) > 1) {
      throw new AiGenError('Kolors 最多支持一张参考图', 400, undefined, 'rejected');
    }
    if (!['1024x1024', '960x1280', '768x1024', '720x1440', '720x1280'].includes(size)) {
      throw new AiGenError('Kolors 图片尺寸不受支持', 400, undefined, 'rejected');
    }
    try {
      const response = await fetch(`${(this.config.baseUrl ?? 'https://api.siliconflow.cn/v1').replace(/\/$/, '')}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ model, prompt: options.prompt, image_size: size, num_inference_steps: 20, guidance_scale: 7.5,
          ...(options.imageUrls?.[0] && { image: options.imageUrls[0] }),
        }),
        signal: options.signal,
      });
      if (!response.ok) {
        // Do not include provider response bodies, which may contain sensitive request data.
        throw new AiGenError(`硅基流动图片生成失败 (${response.status})`, response.status, undefined,
          response.status >= 500 || response.status === 408 ? 'unknown' : 'rejected');
      }
      const data = await response.json() as { images?: Array<{ url?: string }> };
      const url = data.images?.[0]?.url;
      if (!url) throw new AiGenError('硅基流动返回格式异常：缺少 images[0].url');
      return { url, type: 'image', model, prompt: options.prompt };
    } catch (error) {
      if (error instanceof AiGenError) throw error;
      throw new AiGenError('硅基流动图片生成网络错误', undefined, error, 'unknown');
    }
  }

  async generateVideo(_options: GenerateOptions): Promise<GenerateResult> {
    throw new AiGenError('Kolors 不支持视频生成', 400, undefined, 'rejected');
  }
}
