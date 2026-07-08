import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import ffmpegStaticPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';
import type { RenderQuality, Timeline } from '@reel/contracts';
import { buildGraph, type RenderAsset } from './render-graph';

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
): Promise<RenderResult> {
  const graph = buildGraph(timeline, assetById);
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
  const audioFilters = graph.complexFilter.filter((filter) => filter.includes(':a]') || filter.includes('amix'));
  if (audioFilters.length > 0) {
    console.log('[RENDER] audio filters:', audioFilters.join(' | '));
  }

  return new Promise<RenderResult>((resolve, reject) => {
    if (graph.inputs.length === 0) {
      reject(new Error('时间轴没有可导出的素材'));
      return;
    }

    const cmd = ffmpeg();
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
        resolve({ durationSec: graph.durationSec });
      })
      .on('error', (err, _stdout, stderr) => {
        reject(new Error(`FFmpeg 失败: ${err.message}\n${stderr ?? ''}`));
      })
      .save(outputPath);
  });
}
