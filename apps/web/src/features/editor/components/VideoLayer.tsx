import { useEffect, useRef } from 'react';
import type { Asset, Clip } from '@reel/contracts';

interface VideoLayerProps {
  clip: Clip;
  asset: Asset;
  /** 该层是否静音（轨道静音 或 片段静音） */
  muted: boolean;
  fps: number;
  currentFrame: number;
  isPlaying: boolean;
  /** CSS transform：缩放 + 位移（项目像素已换算到显示空间） */
  transform: string;
}

/**
 * 预览中的单个视频层。自管 <video>：按时间轴时钟同步 currentTime，
 * 播放时用原生 play() 流畅解码、仅漂移 >0.3s 才纠偏（与单层逻辑一致）。
 * 多层叠加时每层一个实例，各自解码。
 */
export function VideoLayer({
  clip,
  asset,
  muted,
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
    const targetTime = Math.max(0, (Math.floor(currentFrame) - clip.start + clip.trimStart) / fps);
    video.muted = muted;
    if (isPlaying) {
      if (Math.abs(video.currentTime - targetTime) > 0.3) video.currentTime = targetTime;
      if (video.paused) void video.play().catch(() => undefined);
    } else {
      if (!video.paused) video.pause();
      video.currentTime = targetTime;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFrame, isPlaying, muted, clip.start, clip.trimStart, fps]);

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
