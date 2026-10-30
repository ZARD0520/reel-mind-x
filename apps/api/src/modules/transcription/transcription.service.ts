import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';

export const TRANSCRIPTION_MAX_BYTES = 10 * 1024 * 1024;
export const TRANSCRIPTION_AUDIO_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mpeg']);

@Injectable()
export class TranscriptionService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async transcribe(file?: Express.Multer.File): Promise<{ text: string }> {
    if (!file?.buffer?.length) throw new BadRequestException('请先录制语音');
    const mime = file.mimetype.split(';')[0]!.trim().toLowerCase();
    if (!TRANSCRIPTION_AUDIO_TYPES.has(mime) || file.buffer.length > TRANSCRIPTION_MAX_BYTES) {
      throw new BadRequestException('录音格式不受支持或文件超过 10MB');
    }
    const apiKey = this.config.get('SILICONFLOW_API_KEY', { infer: true });
    if (!apiKey) throw new ServiceUnavailableException('语音服务尚未配置');
    const body = new FormData();
    const extension = mime === 'audio/mp4' ? 'm4a' : mime === 'audio/mpeg' ? 'mp3' : mime === 'audio/x-wav' ? 'wav' : mime.split('/')[1];
    body.append('file', new Blob([new Uint8Array(file.buffer)], { type: mime }), `recording.${extension}`);
    body.append('model', this.config.get('SILICONFLOW_ASR_MODEL', { infer: true }));
    let response: Response;
    try {
      response = await fetch(`${this.config.get('SILICONFLOW_BASE_URL', { infer: true }).replace(/\/$/, '')}/audio/transcriptions`, {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body,
        signal: AbortSignal.timeout(120000),
      });
    } catch {
      throw new ServiceUnavailableException('语音识别超时或网络异常，请稍后重试');
    }
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) throw new ServiceUnavailableException('语音服务繁忙，请稍后重试');
      throw new BadGatewayException('语音识别失败，请稍后重新录音');
    }
    const result = await response.json().catch(() => null) as { text?: unknown } | null;
    if (typeof result?.text !== 'string') throw new BadGatewayException('语音识别结果异常，请稍后重试');
    return { text: result.text.trim() };
  }
}
