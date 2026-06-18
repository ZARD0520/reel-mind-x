import { useEffect, useRef } from 'react';
import type { Asset, Timeline } from '@reel/contracts';

interface AudioMixerProps {
  timeline: Timeline;
  assetById: Map<string, Asset>;
  currentFrame: number;
  isPlaying: boolean;
}

/**
 * 预览音频混音：为每个音频片段挂一个 <audio>，按时间轴时钟同步播放。
 * 音频解码极轻，几十路并发也不卡（区别于多路视频解码）。
 * 遵守：轨道静音(track.muted) 或 片段静音(transform.volume===0) → 不发声。
 */
export function AudioMixer({ timeline, assetById, currentFrame, isPlaying }: AudioMixerProps) {
  const fps = timeline.settings.fps;
  const audioClips = timeline.tracks
    .filter((t) => t.kind === 'audio')
    .flatMap((t) => t.clips.map((clip) => ({ clip, trackMuted: t.muted })));

  return (
    <div className="hidden">
      {audioClips.map(({ clip, trackMuted }) => {
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
            muted={trackMuted}
            fps={fps}
            currentFrame={currentFrame}
            isPlaying={isPlaying}
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
  muted: boolean;
  fps: number;
  currentFrame: number;
  isPlaying: boolean;
}

function AudioVoice({
  url,
  start,
  durationInFrames,
  trimStart,
  volume,
  muted,
  fps,
  currentFrame,
  isPlaying,
}: AudioVoiceProps) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const f = Math.floor(currentFrame);
    const active = f >= start && f < start + durationInFrames;
    const audible = active && isPlaying && !muted && volume > 0;
    const targetTime = Math.max(0, (f - start + trimStart) / fps);

    el.volume = Math.max(0, Math.min(1, volume));
    if (audible) {
      if (Math.abs(el.currentTime - targetTime) > 0.3) el.currentTime = targetTime;
      if (el.paused) void el.play().catch(() => undefined);
    } else if (!el.paused) {
      el.pause();
    }
  }, [currentFrame, isPlaying, muted, volume, start, durationInFrames, trimStart, fps]);

  return <audio ref={ref} src={url} preload="auto" />;
}
