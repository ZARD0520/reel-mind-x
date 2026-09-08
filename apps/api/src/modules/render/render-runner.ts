import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import ffmpegStaticPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import type { RenderQuality, Timeline } from '@reel/contracts';
import { buildGraph, type RenderAsset } from './render-graph';
import { RenderCancelledError, RenderPipelineError } from './render.errors';

ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH || ffmpegStaticPath || ffmpegInstaller.path);
ffmpeg.setFfprobePath(process.env.FFPROBE_PATH || ffprobeInstaller.path);

export interface RenderResult {
  durationSec: number;
}

const QUALITY_PRESETS: Record<
  RenderQuality,
  { crf: number; preset: string; scale: number; audioKbps: string }
> = {
  high: { crf: 18, preset: 'medium', scale: 1, audioKbps: '192k' },
  medium: { crf: 23, preset: 'veryfast', scale: 1, audioKbps: '128k' },
  low: { crf: 28, preset: 'veryfast', scale: 0.5, audioKbps: '96k' },
};

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

export function renderTimeline(
  timeline: Timeline,
  assetById: Map<string, RenderAsset>,
  outputPath: string,
  quality: RenderQuality,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<RenderResult> {
  let graph: ReturnType<typeof buildGraph>;
  try {
    graph = buildGraph(timeline, assetById);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new RenderPipelineError(
      'TIMELINE_GRAPH_INVALID',
      'timeline',
      'rendering',
      false,
      '时间轴无法构建渲染图，请检查片段时长、轨道和转场设置',
      detail,
    );
  }
  const { width, height, fps } = timeline.settings;
  const q = QUALITY_PRESETS[quality];
  const outW = even(width * q.scale);
  const outH = even(height * q.scale);

  console.log('[RENDER] start');
  console.log(
    '[RENDER] timeline:',
    `tracks=${timeline.tracks.length}`,
    `fps=${fps}`,
    `resolution=${width}x${height}`,
  );
  console.log(
    '[RENDER] graph:',
    `durationSec=${graph.durationSec.toFixed(2)}`,
    `inputs=${graph.inputs.length}`,
    `hasAudio=${graph.hasAudio}`,
    `filters=${graph.complexFilter.length}`,
  );
  const audioFilters = graph.complexFilter.filter(
    (filter) => filter.includes(':a]') || filter.includes('amix'),
  );
  if (audioFilters.length > 0) {
    console.log('[RENDER] audio filters:', audioFilters.join(' | '));
  }

  return new Promise<RenderResult>((resolve, reject) => {
    if (graph.inputs.length === 0) {
      reject(
        new RenderPipelineError(
          'TIMELINE_EMPTY',
          'timeline',
          'rendering',
          false,
          '时间轴没有可导出的视频或图片素材',
        ),
      );
      return;
    }

    const cmd = ffmpeg();
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abortRender);
      callback();
    };
    const abortRender = () => {
      if (settled) return;
      try {
        cmd.kill('SIGKILL');
      } catch {
        // The process may not have spawned yet; rejecting still stops this attempt.
      }
      finish(() => reject(new RenderCancelledError('rendering')));
    };

    if (signal?.aborted) {
      finish(() => reject(new RenderCancelledError('rendering')));
      return;
    }
    signal?.addEventListener('abort', abortRender, { once: true });

    for (const input of graph.inputs) {
      cmd.input(input.path);
      if (input.options.length > 0) cmd.inputOptions(input.options);
    }

    cmd.complexFilter(graph.complexFilter, undefined);

    const outputOpts = [
      ...graph.maps.flatMap((m) => ['-map', m]),
      '-r',
      String(fps),
      '-s',
      `${outW}x${outH}`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      q.preset,
      '-crf',
      String(q.crf),
      '-movflags',
      '+faststart',
      '-t',
      graph.durationSec.toFixed(4),
    ];

    if (graph.hasAudio) {
      outputOpts.push('-c:a', 'aac', '-b:a', q.audioKbps);
    } else {
      outputOpts.push('-an');
    }

    cmd
      .outputOptions(outputOpts)
      .on('progress', (p) => {
        const pct = typeof p.percent === 'number' ? Math.max(0, Math.min(99, p.percent)) : 0;
        onProgress(Math.round(pct));
      })
      .on('end', () => {
        onProgress(100);
        finish(() => resolve({ durationSec: graph.durationSec }));
      })
      .on('error', (err, _stdout, stderr) => {
        if (settled) return;
        const detail = `${err.message}\n${stderr ?? ''}`.trim();
        const lower = detail.toLowerCase();
        if (signal?.aborted) {
          finish(() => reject(new RenderCancelledError('rendering')));
          return;
        }
        if (lower.includes('no space left on device') || lower.includes('enospc')) {
          finish(() =>
            reject(
              new RenderPipelineError(
                'STORAGE_FULL',
                'storage',
                'rendering',
                false,
                '渲染过程中存储空间不足，请清理空间后重新导出',
                detail,
              ),
            ),
          );
          return;
        }
        if (lower.includes('permission denied') || lower.includes('eacces')) {
          finish(() =>
            reject(
              new RenderPipelineError(
                'STORAGE_PERMISSION_DENIED',
                'storage',
                'rendering',
                false,
                'FFmpeg 无法写入导出文件，请检查服务器目录权限',
                detail,
              ),
            ),
          );
          return;
        }
        if (
          lower.includes('invalid data found') ||
          lower.includes('error while decoding') ||
          lower.includes('could not find codec parameters')
        ) {
          finish(() =>
            reject(
              new RenderPipelineError(
                'MEDIA_DECODE_FAILED',
                'media',
                'rendering',
                false,
                '素材解码失败，请检查素材文件是否损坏或更换编码格式',
                detail,
              ),
            ),
          );
          return;
        }
        if (
          lower.includes('cannot find ffmpeg') ||
          lower.includes('ffmpeg was not found') ||
          (lower.includes('spawn') && lower.includes('enoent'))
        ) {
          finish(() =>
            reject(
              new RenderPipelineError(
                'FFMPEG_NOT_AVAILABLE',
                'ffmpeg',
                'rendering',
                false,
                '服务器未正确安装 FFmpeg，暂时无法执行导出',
                detail,
              ),
            ),
          );
          return;
        }
        finish(() =>
          reject(
            new RenderPipelineError(
              'FFMPEG_PROCESS_FAILED',
              'ffmpeg',
              'rendering',
              true,
              'FFmpeg 合成进程异常退出，系统将自动重试',
              detail,
            ),
          ),
        );
      })
      .save(outputPath);
  });
}
