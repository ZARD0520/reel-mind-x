import { useEffect, useRef } from 'react';
import type { Asset, Timeline } from '@reel/contracts';

interface AudioMixerProps {
  timeline: Timeline;
  assetById: Map<string, Asset>;
  currentFrame: number;
  isPlaying: boolean;
  /** 音频播放权限是否已激活（防止 autoplay 拒绝） */
  audioUnlocked: boolean;
}

/**
 * 预览音频混音：为每个音频片段挂一个 <audio>，按时间轴时钟同步播放。
 * 音频解码极轻，几十路并发也不卡（区别于多路视频解码）。
 * 遵守：轨道静音(track.muted) 或 片段静音(transform.volume===0) → 不发声。
 */
export function AudioMixer({ timeline, assetById, currentFrame, isPlaying, audioUnlocked }: AudioMixerProps) {
  const fps = timeline.settings.fps;
  const audioClips = timeline.tracks
    .filter((t) => t.kind === 'audio')
    .flatMap((t) => t.clips.map((clip) => ({ clip, muted: t.muted || clip.transform.volume === 0 })));

  return (
    <div className="hidden">
      {audioClips.map(({ clip, muted }) => {
        const asset = assetById.get(clip.assetId);
        if (!asset?.url || asset.status !== 'ready') return null;
        return (
          <AudioVoice
            key={clip.id}
            url={asset.url}
            start={clip.start}
            durationInFrames={clip.durationInFrames}
            trimStart={clip.trimStart}
            volume={clip.transform.volume}
            speed={clip.transform.speed}
            muted={muted}
            fps={fps}
            currentFrame={currentFrame}
            isPlaying={isPlaying}
            audioUnlocked={audioUnlocked}
          />
        );
      })}
    </div>
  );
}

interface AudioVoiceProps {
  url: string;
  start: number;
  durationInFrames: number;
  trimStart: number;
  volume: number;
  speed: number;
  muted: boolean;
  fps: number;
  currentFrame: number;
  isPlaying: boolean;
  audioUnlocked: boolean;
}

function AudioVoice({
  url,
  start,
  durationInFrames,
  trimStart,
  volume,
  speed,
  muted,
  fps,
  currentFrame,
  isPlaying,
  audioUnlocked,
}: AudioVoiceProps) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const f = Math.floor(currentFrame);
    const active = f >= start && f < start + durationInFrames;
    const audible = active && isPlaying && !muted && volume > 0;
    // 变速：timeline 推进 1 帧 → 源消耗 speed 帧。
    const targetTime = Math.max(0, ((f - start) * speed + trimStart) / fps);

    el.volume = Math.max(0, Math.min(1, volume));
    el.playbackRate = speed;
    if (audible) {
      if (Math.abs(el.currentTime - targetTime) > 0.3) el.currentTime = targetTime;
      // 等待 unlock，否则 play() 会被 autoplay 策略拒绝（NotAllowedError）且无法发声。
      // 解锁一般在首次点击/按键后即完成，几乎无等待感知。
      if (audioUnlocked && el.paused) {
        void el.play().catch((err) => {
          // 仍可能被拒（少见，用户可能关闭了媒体自动播放权限）。现在暴露错误帮助定位。
          console.warn('[AudioVoice] play() rejected:', err.message || err);
        });
      }
    } else if (!el.paused) {
      el.pause();
    }
  }, [currentFrame, isPlaying, muted, volume, speed, start, durationInFrames, trimStart, fps, audioUnlocked]);

  return <audio ref={ref} src={url} preload="auto" />;
}
