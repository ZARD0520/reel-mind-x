import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import ffmpegStaticPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import type { RenderQuality, Timeline } from '@reel/contracts';
import { buildGraph, type RenderAsset } from './render-graph';

// 优先用 ffmpeg-static（较新版本，支持 amix normalize 等新滤镜选项）；
// 回退到 @ffmpeg-installer（旧版，部分滤镜选项不支持）。
ffmpeg.setFfmpegPath(ffmpegStaticPath ?? ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

export interface RenderResult {
  durationSec: number;
}

/** 质量档 → 编码参数（CRF 越小越清晰、码率越高；分辨率按比例缩放）。 */
const QUALITY_PRESETS: Record<RenderQuality, { crf: number; preset: string; scale: number; audioKbps: string }> = {
  high: { crf: 18, preset: 'medium', scale: 1, audioKbps: '192k' },
  medium: { crf: 23, preset: 'veryfast', scale: 1, audioKbps: '128k' },
  low: { crf: 28, preset: 'veryfast', scale: 0.5, audioKbps: '96k' },
};

/** 偶数化（libx264 要求宽高为偶数）。 */
function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * 用 FFmpeg 把 timeline 合成成 mp4，写到 outputPath。
 * onProgress(0..100) 回调用于回写进度。
 */
export function renderTimeline(
  timeline: Timeline,
  assetById: Map<string, RenderAsset>,
  outputPath: string,
  quality: RenderQuality,
  onProgress: (percent: number) => void,
): Promise<RenderResult> {
  const graph = buildGraph(timeline, assetById);
  const { width, height, fps } = timeline.settings;
  const q = QUALITY_PRESETS[quality];
  const outW = even(width * q.scale);
  const outH = even(height * q.scale);

  return new Promise<RenderResult>((resolve, reject) => {
    if (graph.inputs.length === 0) {
      reject(new Error('时间轴没有可导出的素材'));
      return;
    }

    const cmd = ffmpeg();
    for (const input of graph.inputs) {
      cmd.input(input.path);
      if (input.options.length) cmd.inputOptions(input.options);
    }

    cmd.complexFilter(graph.complexFilter, undefined);

    const outputOpts = [
      ...graph.maps.flatMap((m) => ['-map', m]),
      '-r', String(fps),
      '-s', `${outW}x${outH}`,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', q.preset,
      '-crf', String(q.crf),
      '-movflags', '+faststart',
      '-t', graph.durationSec.toFixed(4),
    ];
    if (graph.hasAudio) {
      outputOpts.push('-c:a', 'aac', '-b:a', q.audioKbps);
    } else {
      outputOpts.push('-an');
    }

    cmd
      .outputOptions(outputOpts)
      .on('progress', (p) => {
        // fluent 的 percent 基于时长估算，可能为 undefined/越界。
        const pct = typeof p.percent === 'number' ? Math.max(0, Math.min(99, p.percent)) : 0;
        onProgress(Math.round(pct));
      })
      .on('end', () => {
        onProgress(100);
        resolve({ durationSec: graph.durationSec });
      })
      .on('error', (err, _stdout, stderr) => {
        reject(new Error(`FFmpeg 失败: ${err.message}\n${stderr ?? ''}`));
      })
      .save(outputPath);
  });
}
