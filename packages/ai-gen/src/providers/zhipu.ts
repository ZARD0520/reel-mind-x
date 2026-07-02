import type {
  AiGenProvider,
  AiGenProviderConfig,
  GenerateOptions,
  GenerateResult,
} from '../types';
import { AiGenError } from '../types';

/**
 * 智谱 AI 图像/视频生成 provider。
 * - CogView-3-Flash：同步图像生成
 * - CogVideoX-Flash：异步视频生成（提交任务 → 轮询结果）
 * API 文档：https://docs.bigmodel.cn/cn/guide/models/image/cogview-3
 *           https://docs.bigmodel.cn/cn/guide/models/video/cogvideox
 */
export class ZhipuAiGenProvider implements AiGenProvider {
  readonly name = 'zhipu';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly imageModel: string;
  private readonly videoModel: string;

  constructor(config: AiGenProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://open.bigmodel.cn/api/paas/v4';
    this.imageModel = config.imageModel ?? 'cogview-3-flash';
    this.videoModel = config.videoModel ?? 'cogvideox-flash';
  }

  async generateImage(options: GenerateOptions): Promise<GenerateResult> {
    const { prompt, size = '1024x1024', signal } = options;
    const url = `${this.baseUrl}/images/generations`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.imageModel,
          prompt,
          size,
        }),
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '无法读取响应');
        throw new AiGenError(
          `智谱图像生成失败 (${response.status}): ${text}`,
          response.status,
        );
      }

      const data = (await response.json()) as ImageResponse;
      const imageUrl = data.data?.[0]?.url;
      if (!imageUrl) {
        throw new AiGenError('智谱返回格式异常：缺少 data[0].url');
      }

      return {
        url: imageUrl,
        type: 'image',
        model: this.imageModel,
        prompt,
      };
    } catch (err) {
      if (err instanceof AiGenError) throw err;
      throw new AiGenError('智谱图像生成网络错误', undefined, err);
    }
  }

  async generateVideo(options: GenerateOptions): Promise<GenerateResult> {
    const { prompt, signal } = options;
    const submitUrl = `${this.baseUrl}/videos/generations`;

    try {
      // 1. 提交异步任务
      const submitRes = await fetch(submitUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.videoModel,
          prompt,
        }),
        signal,
      });

      if (!submitRes.ok) {
        const text = await submitRes.text().catch(() => '无法读取响应');
        throw new AiGenError(
          `智谱视频生成提交失败 (${submitRes.status}): ${text}`,
          submitRes.status,
        );
      }

      const submitData = (await submitRes.json()) as VideoSubmitResponse;
      const requestId = submitData.id;
      if (!requestId) {
        throw new AiGenError('智谱返回格式异常：缺少任务 id');
      }

      // 2. 轮询异步结果（每 5s 查一次，最多等 10 分钟）
      return await this.pollVideoResult(requestId, signal);
    } catch (err) {
      if (err instanceof AiGenError) throw err;
      throw new AiGenError('智谱视频生成网络错误', undefined, err);
    }
  }

  /** 轮询视频生成结果（供 BullMQ job 使用） */
  async pollVideoResult(
    requestId: string,
    signal?: AbortSignal,
  ): Promise<GenerateResult> {
    const resultUrl = `${this.baseUrl}/async-result/${requestId}`;
    const maxAttempts = 120; // 10 分钟（每次 5s）
    const interval = 5000; // 5s

    for (let i = 0; i < maxAttempts; i++) {
      if (signal?.aborted) {
        throw new AiGenError('视频生成已中断');
      }

      const response = await fetch(resultUrl, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '无法读取响应');
        throw new AiGenError(
          `智谱视频查询失败 (${response.status}): ${text}`,
          response.status,
        );
      }

      const data = (await response.json()) as VideoResultResponse;

      if (data.task_status === 'SUCCESS') {
        const videoUrl = data.video_result?.[0]?.url;
        if (!videoUrl) {
          throw new AiGenError('智谱返回格式异常：缺少 video_result[0].url');
        }
        return {
          url: videoUrl,
          type: 'video',
          model: this.videoModel,
          prompt: data.model || '',
        };
      }

      if (data.task_status === 'FAILED') {
        throw new AiGenError(`智谱视频生成失败: ${data.error?.message ?? '未知错误'}`);
      }

      // PROCESSING / 其他状态：继续等待
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new AiGenError('视频生成超时（10 分钟）');
  }
}

// ─── 智谱 API 响应类型 ─────────────────────────────────────────────

interface ImageResponse {
  created: number;
  data: Array<{ url: string }>;
}

interface VideoSubmitResponse {
  id: string;
  model: string;
}

interface VideoResultResponse {
  task_status: 'PROCESSING' | 'SUCCESS' | 'FAILED';
  model?: string;
  video_result?: Array<{ url: string; cover_image_url: string }>;
  error?: { message: string };
}
