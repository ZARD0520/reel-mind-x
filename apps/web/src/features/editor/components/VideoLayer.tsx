import { useEffect, useRef } from 'react';
import type { Asset, Clip } from '@reel/contracts';

interface VideoLayerProps {
  clip: Clip;
  asset: Asset;
  /** 该层是否静音（轨道静音 或 片段静音） */
  muted: boolean;
  /** 音量 0..1 */
  volume: number;
  /** 播放速率（变速），1 = 原速 */
  speed: number;
  /** 淡入时长（秒），0 表示无淡入 */
  fadeInDuration: number;
  /** 淡出时长（秒），0 表示无淡出 */
  fadeOutDuration: number;
  fps: number;
  currentFrame: number;
  isPlaying: boolean;
  /** CSS transform：缩放 + 位移（项目像素已换算到显示空间） */
  transform: string;
}

/** 计算片段内某帧的淡入淡出增益系数（0..1），基于时间轴占用时长 */
function fadeGainAt(
  frame: number,
  start: number,
  durationInFrames: number,
  fadeInDuration: number,
  fadeOutDuration: number,
  fps: number,
): number {
  const clipDurationSec = durationInFrames / fps;
  const elapsedSec = (frame - start) / fps;
  let gain = 1;
  if (fadeInDuration > 0 && elapsedSec < fadeInDuration) {
    gain = Math.max(0, elapsedSec / fadeInDuration);
  }
  const remainingSec = clipDurationSec - elapsedSec;
  if (fadeOutDuration > 0 && remainingSec < fadeOutDuration) {
    gain *= Math.max(0, remainingSec / fadeOutDuration);
  }
  return gain;
}

/**
 * 预览中的单个视频层。自管 <video>：按时间轴时钟同步 currentTime，
 * 播放时用原生 play() 流畅解码、仅漂移 >0.3s 才纠偏（与单层逻辑一致）。
 * 变速：source 时间 = (timeline 帧偏移 × speed) / fps；playbackRate=speed。
 * 音频淡入淡出：逐帧计算增益系数，乘到 video.volume。
 */
export function VideoLayer({
  clip,
  asset,
  muted,
  volume,
  speed,
  fadeInDuration,
  fadeOutDuration,
  fps,
  currentFrame,
  isPlaying,
  transform,
}: VideoLayerProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const url = asset.url!;
    if ((video.getAttribute('src') ?? '') !== url) {
      video.setAttribute('src', url);
      video.load();
    }
  }, [asset.url]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const f = Math.floor(currentFrame);
    // 变速下，timeline 推进 1 帧 → 源消耗 speed 帧。
    const targetTime = Math.max(0, ((f - clip.start) * speed + clip.trimStart) / fps);

    // 计算淡入淡出增益
    const fadeGain = fadeGainAt(f, clip.start, clip.durationInFrames, fadeInDuration, fadeOutDuration, fps);
    const finalVolume = Math.max(0, Math.min(1, volume * fadeGain));

    video.muted = muted;
    video.volume = finalVolume;
    video.playbackRate = speed;
    if (isPlaying) {
      if (Math.abs(video.currentTime - targetTime) > 0.3) video.currentTime = targetTime;
      if (video.paused) void video.play().catch(() => undefined);
    } else {
      if (!video.paused) video.pause();
      video.currentTime = targetTime;
    }
  }, [currentFrame, isPlaying, muted, volume, speed, fadeInDuration, fadeOutDuration, clip.start, clip.durationInFrames, clip.trimStart, fps]);

  return (
    <video
      ref={ref}
      className="absolute inset-0 h-full w-full object-contain"
      style={{ transform, transformOrigin: 'center' }}
      playsInline
      preload="auto"
    />
  );
}
