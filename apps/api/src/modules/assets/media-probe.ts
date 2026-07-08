import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import ffmpeg from 'fluent-ffmpeg';
import type { AssetKind } from '@reel/contracts';

ffmpeg.setFfprobePath(process.env.FFPROBE_PATH || ffprobeInstaller.path);

export interface ProbeResult {
  kind: AssetKind;
  durationInFrames: number | null;
  width: number | null;
  height: number | null;
  /** 音频流编码名（如 aac/alac/mp3）；无音频或探测失败为 null */
  audioCodec: string | null;
  /** 视频流编码名（如 h264/hevc/prores）；无视频或探测失败为 null */
  videoCodec: string | null;
}

const IMAGE_MIME = /^image\//;
const VIDEO_MIME = /^video\//;
const AUDIO_MIME = /^audio\//;

/** 由 mimetype 粗判素材类型（探测失败时的兜底） */
export function kindFromMime(mime: string): AssetKind {
  if (VIDEO_MIME.test(mime)) return 'video';
  if (AUDIO_MIME.test(mime)) return 'audio';
  if (IMAGE_MIME.test(mime)) return 'image';
  return 'video';
}

/**
 * 用 ffprobe 探测媒体元信息。时长按项目 fps 折算成帧。
 * 图片无时长；探测失败回退到 mimetype 推断、元信息留空。
 */
export function probeMedia(
  filePath: string,
  mime: string,
  fps: number,
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) {
        resolve({
          kind: kindFromMime(mime),
          durationInFrames: null,
          width: null,
          height: null,
          audioCodec: null,
          videoCodec: null,
        });
        return;
      }
      const stream = data.streams?.find((s) => s.width || s.codec_type === 'audio');
      const videoStream = data.streams?.find((s) => s.codec_type === 'video');
      const audioStream = data.streams?.find((s) => s.codec_type === 'audio');
      const hasVideo = !!videoStream;
      const hasAudio = !!audioStream;

      let kind: AssetKind = kindFromMime(mime);
      if (IMAGE_MIME.test(mime)) kind = 'image';
      else if (hasVideo) kind = 'video';
      else if (hasAudio) kind = 'audio';

      const durationSec = data.format?.duration;
      const durationInFrames =
        kind === 'image' || !durationSec ? null : Math.round(durationSec * fps);

      resolve({
        kind,
        durationInFrames,
        width: stream?.width ?? null,
        height: stream?.height ?? null,
        audioCodec: audioStream?.codec_name ?? null,
        videoCodec: videoStream?.codec_name ?? null,
      });
    });
  });
}
