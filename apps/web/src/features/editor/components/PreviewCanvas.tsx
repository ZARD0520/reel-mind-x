import { useEffect, useRef, useState } from 'react';
import { Maximize, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { Asset, Clip, Timeline, Track } from '@reel/contracts';
import { useAssets } from '../hooks';
import { useEditorStore } from '../store';
import { TransformBox } from './TransformBox';
import { AudioMixer } from './AudioMixer';

const STAGE_W = 640;
const STAGE_H = 360;

function formatTimecode(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

interface ActiveItem {
  clip: Clip;
  asset: Asset;
  track: Track;
}

/** 当前帧对应的最顶层可见视频/图片片段（从 tracks 末尾往前找，越后越上层） */
function findActiveItem(
  timeline: Timeline,
  frame: number,
  assetById: Map<string, Asset>,
): ActiveItem | null {
  for (let i = timeline.tracks.length - 1; i >= 0; i--) {
    const track = timeline.tracks[i];
    if (!track || track.kind !== 'video' || track.hidden) continue;
    for (const clip of track.clips) {
      const f = Math.floor(frame);
      if (f >= clip.start && f < clip.start + clip.durationInFrames) {
        const asset = assetById.get(clip.assetId);
        if (asset?.status === 'ready' && asset.url) return { clip, asset, track };
      }
    }
  }
  return null;
}

interface PreviewCanvasProps {
  currentFrame: number;
  totalFrames: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (frame: number) => void;
}

export function PreviewCanvas({
  currentFrame,
  totalFrames,
  isPlaying,
  onTogglePlay,
  onSeek,
}: PreviewCanvasProps) {
  const timeline = useEditorStore((s) => s.timeline);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const { data: assets = [] } = useAssets();
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const fps = timeline?.settings.fps ?? 30;
  const projectW = timeline?.settings.width ?? 1920;
  const projectH = timeline?.settings.height ?? 1080;
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const activeItem = timeline
    ? findActiveItem(timeline, currentFrame, assetById)
    : null;
  const isVideo = activeItem?.asset.kind === 'video';
  const isImage = activeItem?.asset.kind === 'image';

  // 内容（object-contain）在 scale=1 时的显示尺寸与居中留白偏移。
  const contentScale = Math.min(STAGE_W / projectW, STAGE_H / projectH);
  const baseWidth = projectW * contentScale;
  const baseHeight = projectH * contentScale;
  const baseLeft = (STAGE_W - baseWidth) / 2;
  const baseTop = (STAGE_H - baseHeight) / 2;
  // transform.x/y 是项目像素，映射到舞台显示空间的比例。
  const displayScale = contentScale;

  // 选中且为当前活动片段时，显示交互变换框（非全屏）。
  const showBox = !!activeItem && activeItem.clip.id === selectedClipId;

  // 顶层视频自带音轨是否静音：轨道静音 或 片段静音。
  const videoMuted =
    !!activeItem && (activeItem.track.muted || activeItem.clip.transform.volume === 0);

  // 当前内容的 CSS transform（缩放 + 位移，围绕内容中心）。
  const contentTransform = activeItem
    ? `translate(${activeItem.clip.transform.x * displayScale}px, ${activeItem.clip.transform.y * displayScale}px) scale(${activeItem.clip.transform.scale})`
    : undefined;

  /** 切片段时更新 video src（只在 url 变化时 load，避免频繁 reload） */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isVideo || !activeItem) return;
    const url = activeItem.asset.url!;
    if ((video.getAttribute('src') ?? '') !== url) {
      video.setAttribute('src', url);
      video.load();
    }
  }, [isVideo, activeItem?.asset.url]);

  /**
   * 播放/scrub 同步：
   * - 播放中：用浏览器原生播放（流畅），仅当与时间轴时钟漂移 > 0.3s 时才纠偏，
   *   避免每帧 setCurrentTime 反复 seek 导致卡顿。
   * - 暂停/拖动：精确 seek 到当前帧（scrubbing）。
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isVideo || !activeItem) {
      video?.pause();
      return;
    }
    const targetTime = Math.max(
      0,
      (Math.floor(currentFrame) - activeItem.clip.start + activeItem.clip.trimStart) / fps,
    );
    video.muted = videoMuted;
    if (isPlaying) {
      if (Math.abs(video.currentTime - targetTime) > 0.3) video.currentTime = targetTime;
      if (video.paused) void video.play().catch(() => undefined);
    } else {
      if (!video.paused) video.pause();
      video.currentTime = targetTime;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFrame, isPlaying, isVideo, activeItem?.clip.id, fps, videoMuted]);

  const timecode = formatTimecode(currentFrame / fps);
  const totalTimecode = formatTimecode(totalFrames / fps);

  // 跟踪全屏状态：全屏时单击画面切换播放/暂停。
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen();
  };

  return (
    <div className="flex h-full flex-1 flex-col bg-base">
      {/* 音频混音：播放所有命中的音频片段（隐藏元素） */}
      {timeline && (
        <AudioMixer
          timeline={timeline}
          assetById={assetById}
          currentFrame={currentFrame}
          isPlaying={isPlaying}
        />
      )}
      <div className="flex flex-1 items-center justify-center p-8">
        <div
          ref={stageRef}
          onClick={() => isFullscreen && onTogglePlay()}
          className={`relative overflow-hidden rounded-lg border border-border-subtle bg-black ${
            isFullscreen ? 'flex h-full w-full cursor-pointer items-center justify-center' : ''
          }`}
          style={isFullscreen ? undefined : { width: 640, height: 360 }}
        >
          {/* video element：常驻 DOM，避免 ref 失效；src 改变时更新 */}
          <video
            ref={videoRef}
            className={`absolute inset-0 h-full w-full object-contain ${isVideo ? 'block' : 'hidden'}`}
            style={{ transform: contentTransform, transformOrigin: 'center' }}
            playsInline
            preload="auto"
            muted={false}
          />
          {/* 图片 */}
          {isImage && (
            <img
              src={activeItem.asset.url!}
              alt={activeItem.asset.name}
              className="absolute inset-0 h-full w-full object-contain"
              style={{ transform: contentTransform, transformOrigin: 'center' }}
            />
          )}
          {/* 交互式变换框（选中当前片段、非全屏时） */}
          {showBox && !isFullscreen && activeItem && (
            <TransformBox
              clip={activeItem.clip}
              displayScale={displayScale}
              baseWidth={baseWidth}
              baseHeight={baseHeight}
              baseLeft={baseLeft}
              baseTop={baseTop}
            />
          )}
          {/* 无片段 / 纯音频 → 占位 */}
          {!isVideo && !isImage && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-tertiary">
              <span className="font-mono text-5xl font-bold text-input">{timecode}</span>
              <span className="text-[13px]">{timeline?.tracks.length ? '无视频片段' : '从左侧添加素材'}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex h-13 items-center justify-between border-t border-border-subtle bg-surface px-5 py-3">
        <span className="text-[13px] text-fg-secondary">{timecode}</span>
        <div className="flex items-center gap-[18px]">
          <button
            type="button"
            onClick={() => onSeek(0)}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-fg-secondary hover:bg-elevated"
          >
            <SkipBack className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-elevated text-fg hover:bg-input"
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={() => onSeek(totalFrames)}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-fg-secondary hover:bg-elevated"
          >
            <SkipForward className="h-[18px] w-[18px]" />
          </button>
        </div>
        <div className="flex items-center gap-3.5">
          <span className="text-[13px] text-fg-tertiary">{totalTimecode}</span>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="text-fg-secondary hover:text-fg"
          >
            <Maximize className="h-[17px] w-[17px]" />
          </button>
        </div>
      </div>
    </div>
  );
}
