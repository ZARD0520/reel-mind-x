import ffmpegStatic from 'ffmpeg-static';
import { spawn } from 'child_process';
import * as fs from 'fs';

const ffmpegPath = process.env.FFMPEG_PATH || ffmpegStatic;

/**
 * 浏览器原生支持的音视频编码（<audio>/<video> 元素可直接播放）。
 * 不在此列的编码需转码成 Web 兼容格式才能预览。
 *
 * 音频：aac, mp3, opus, vorbis
 * 视频：h264 (AVC), vp8, vp9（暂只保证 h264，高通用性）
 */
const WEB_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis']);
const WEB_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9']);

/**
 * 判断音视频编码是否需要转码（浏览器不支持 → 需转码）。
 * 图片/无流/探测失败返回 false（直接用原文件）。
 */
export function needsTranscode(probe: {
  kind: string;
  audioCodec: string | null;
  videoCodec: string | null;
}): boolean {
  const { kind, audioCodec, videoCodec } = probe;
  if (kind === 'image') return false; // 图片直接用

  if (kind === 'audio') {
    // 纯音频：检查音频编码。null=探测失败，保守用原文件。
    return audioCodec !== null && !WEB_AUDIO_CODECS.has(audioCodec);
  }

  if (kind === 'video') {
    // 视频：检查视频编码和音频编码。任一不兼容都需转码。
    // videoCodec=null 时保守用原文件（探测失败/无视频流但 kind='video' 的罕见场景）。
    const videoIncompat = videoCodec !== null && !WEB_VIDEO_CODECS.has(videoCodec);
    const audioIncompat = audioCodec !== null && !WEB_AUDIO_CODECS.has(audioCodec);
    return videoIncompat || audioIncompat;
  }

  return false;
}

/**
 * 转码为 Web 兼容格式：
 * - 纯音频 → AAC + m4a 容器（最佳兼容性）
 * - 视频 → H.264 视频 + AAC 音频 + mp4 容器
 *
 * @param inputPath 原始上传文件路径
 * @param outputPath 输出路径（调用方需提供，如 /path/to/transcoded-{uuid}.m4a）
 * @param probe 探测结果（决定编码策略）
 * @returns Promise<void>，失败抛 Error
 */
export function transcodeForWeb(
  inputPath: string,
  outputPath: string,
  probe: { kind: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error('FFmpeg binary not found'));
    }

    const isAudio = probe.kind === 'audio';
    // 音频：-c:a aac -b:a 192k，视频：-c:v libx264 -preset fast -crf 23 -c:a aac
    const args = isAudio
      ? ['-y', '-i', inputPath, '-c:a', 'aac', '-b:a', '192k', '-vn', outputPath]
      : [
          '-y',
          '-i',
          inputPath,
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '23',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          outputPath,
        ];

    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (d) => (stderr += d.toString()));

    proc.on('close', (code) => {
      if (code === 0) {
        // 确认输出文件存在
        if (fs.existsSync(outputPath)) resolve();
        else reject(new Error(`Transcode完成但输出文件不存在: ${outputPath}`));
      } else {
        reject(new Error(`FFmpeg transcode failed (exit ${code}): ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => reject(err));
  });
}
