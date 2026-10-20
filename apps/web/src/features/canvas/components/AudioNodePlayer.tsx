import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

const BAR_COUNT = 64;
const emptyWaveform = Array<number>(BAR_COUNT).fill(0.04);

function formatTime(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function AudioNodePlayer({ src, title, autoPlay = false, previewOnly = false }: { src: string; title: string; autoPlay?: boolean; previewOnly?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState(emptyWaveform);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let context: AudioContext | undefined;
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPeaks(emptyWaveform);
    setError('');
    // Decode independently of playback, so drawing the waveform never blocks the player.
    void (async () => {
      try {
        const response = await fetch(src, { signal: controller.signal });
        if (!response.ok || Number(response.headers.get('content-length')) > 32 * 1024 * 1024) return;
        const bytes = await response.arrayBuffer();
        if (controller.signal.aborted || bytes.byteLength > 32 * 1024 * 1024) return;
        context = new AudioContext();
        const buffer = await context.decodeAudioData(bytes);
        if (controller.signal.aborted) return;
        const values = Array<number>(BAR_COUNT).fill(0);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const samples = buffer.getChannelData(channel);
          for (let bar = 0; bar < BAR_COUNT; bar++) {
            const start = Math.floor(bar * samples.length / BAR_COUNT);
            const end = Math.floor((bar + 1) * samples.length / BAR_COUNT);
            let sum = 0;
            for (let index = start; index < end; index++) sum += (samples[index] ?? 0) ** 2;
            values[bar] = Math.max(values[bar] ?? 0, Math.sqrt(sum / Math.max(1, end - start)));
          }
        }
        const maximum = Math.max(...values, 0.001);
        setPeaks(values.map((value) => Math.max(0.04, value / maximum)));
      } catch {
        // Keep a quiet baseline when decoding is unavailable; audio may still play normally.
      } finally {
        if (context && context.state !== 'closed') void context.close().catch(() => {});
      }
    })();
    return () => {
      controller.abort();
      if (context && context.state !== 'closed') void context.close().catch(() => {});
    };
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!autoPlay || !audio) return;
    let active = true;
    void audio.play().then(() => {
      if (!active) audio.pause();
    }).catch(() => {
      // Browsers may block hover autoplay; the play button remains available.
    });
    return () => {
      active = false;
      audio.pause();
    };
  }, [src, autoPlay]);

  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const tick = () => {
      if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const updateDuration = () => {
    const value = audioRef.current?.duration;
    if (value && Number.isFinite(value)) setDuration(value);
  };
  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      if (audio.ended) audio.currentTime = 0;
      await audio.play();
      setError('');
    } catch {
      setError('音频暂时无法播放，请重试');
    }
  };

  return (
    <div
      className={previewOnly ? 'flex h-full w-full flex-col' : 'flex h-full w-full cursor-grab flex-col p-3 active:cursor-grabbing'}
      data-audio-player=""
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        aria-label={title}
        className="hidden"
        onLoadedMetadata={updateDuration}
        onDurationChange={updateDuration}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => { setPlaying(false); setError('音频加载失败，请检查素材'); }}
      />
      <div className={`relative min-h-0 flex-1 ${previewOnly ? '' : 'mb-3'}`} role="group" aria-label="音频波形">
        <div
          className="nodrag nopan nowheel relative h-full w-full overflow-hidden rounded-lg border border-white/[0.06] bg-[#18181b]"
          data-audio-waveform=""
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
        <svg viewBox="0 0 320 120" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
          {peaks.map((value, index) => {
            const height = Math.max(4, value * 100);
            return <rect key={index} x={index * 5 + 1} y={(120 - height) / 2} width="3" height={height} rx="1.5" fill={index / BAR_COUNT < progress ? '#79c7ed' : '#626269'} />;
          })}
        </svg>
        <input
          type="range"
          min="0"
          max={duration || 1}
          step="0.01"
          value={Math.min(currentTime, duration || 1)}
          disabled={!duration}
          aria-label="音频播放进度"
          aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
          className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
          onChange={(event) => {
            const audio = audioRef.current;
            if (!audio || !duration) return;
            audio.currentTime = Number(event.target.value);
            setCurrentTime(audio.currentTime);
          }}
        />
        <div className="pointer-events-none absolute inset-0 rounded-lg ring-inset ring-white/30 [input:focus-visible+&]:ring-1" />
        <div
          data-audio-playhead=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-[#ef4444]"
          style={{ left: `clamp(1px, ${progress * 100}%, calc(100% - 1px))` }}
        />
        </div>
      </div>
      {!previewOnly && <div className="relative flex h-12 shrink-0 items-center justify-center">
        <span className="absolute left-0 text-xs tabular-nums text-[#a1a1aa]" data-audio-time="">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <button
          type="button"
          aria-label={playing ? '暂停音频' : '播放音频'}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); void togglePlayback(); }}
          className="nodrag nopan nowheel flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-white/[0.08] text-white transition-colors hover:border-white/30 hover:bg-white/[0.16] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-300"
        >
          {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="ml-0.5 h-5 w-5 fill-current" />}
        </button>
      </div>}
      {!previewOnly && error && <span role="status" className="mt-2 text-center text-xs text-red-300">{error}</span>}
    </div>
  );
}
