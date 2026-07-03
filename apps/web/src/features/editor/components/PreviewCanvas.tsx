import { useEffect, useRef, useState } from 'react';
import { Maximize, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { Asset, Clip, TextClip, Timeline, Track } from '@reel/contracts';
import { ASPECT_RATIOS } from '../constants';
import { useAssets } from '../hooks';
import { useAudioUnlock } from '../useAudioUnlock';
import { useEditorStore } from '../store';
import { previewTransitions, transitionStyle, type TransitionStyle } from '../transitions';
import { TransformBox } from './TransformBox';
import { AudioMixer } from './AudioMixer';
import { VideoLayer } from './VideoLayer';
import { TextLayer } from './TextLayer';

// 预览舞台最大尺寸（容器）；实际画布按项目比例 object-contain。
const MAX_PREVIEW_W = 640;
const MAX_PREVIEW_H = 480;

function formatTimecode(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

interface ActiveLayer {
  clip: Clip;
  asset: Asset;
  track: Track;
  /** 预览用转场样式：命中转场区时的不透明度 + transform/clip-path */
  transition?: TransitionStyle & { role: 'from' | 'to' };
}

/**
 * 当前帧命中的所有可见视频/图片片段，按图层顺序（底→顶）返回。
 * tracks 数组开头＝底层、末尾＝顶层，正序遍历即底→顶；靠后的盖在靠前的上面。
 * 预览不做时间位移（播放头不跳动），在**存储位置**判定转场：
 * - 出方（from）：在转场区内按曲线淡出 / 位移 / 裁切；
 * - 入方（to）：虽尚未到其 start，也提前加入图层并淡入（显示其首帧）。
 */
function findActiveLayers(
  timeline: Timeline,
  frame: number,
  assetById: Map<string, Asset>,
): ActiveLayer[] {
  const f = Math.floor(frame);
  const layers: ActiveLayer[] = [];
  for (const track of timeline.tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    const xfades = previewTransitions(track.clips, timeline.settings.fps);
    const trackLayers: ActiveLayer[] = [];

    // 命中的正常片段（可能是某转场的出方）。
    for (const clip of track.clips) {
      if (f < clip.start || f >= clip.start + clip.durationInFrames) continue;
      const asset = assetById.get(clip.assetId);
      if (!(asset?.status === 'ready' && asset.url)) continue;
      const layer: ActiveLayer = { clip, asset, track };
      const xf = xfades.find((x) => x.from.id === clip.id && f >= x.startFrame && f < x.startFrame + x.durFrames);
      if (xf) {
        const style = transitionStyle(xf.type, (f - xf.startFrame) / xf.durFrames);
        layer.transition = { ...style, role: 'from' };
      }
      trackLayers.push(layer);
    }

    // 转场区内提前加入的入方片段（淡入，压在出方之上）。
    for (const xf of xfades) {
      if (f < xf.startFrame || f >= xf.startFrame + xf.durFrames) continue;
      const asset = assetById.get(xf.to.assetId);
      if (!(asset?.status === 'ready' && asset.url)) continue;
      const style = transitionStyle(xf.type, (f - xf.startFrame) / xf.durFrames);
      trackLayers.push({ clip: xf.to, asset, track, transition: { ...style, role: 'to' } });
    }

    layers.push(...trackLayers);
  }
  return layers;
}

/** 文本拖拽框：简化版 TransformBox，只做 move（不做 scale）。拖动改 textClip.x/y。 */
function TextDragBox({
  textClip,
  displayScale,
  baseWidth,
  baseHeight,
  baseLeft,
  baseTop,
}: {
  textClip: TextClip;
  displayScale: number;
  baseWidth: number;
  baseHeight: number;
  baseLeft: number;
  baseTop: number;
}) {
  const updateTextClip = useEditorStore((s) => s.updateTextClip);
  const commitHistory = useEditorStore((s) => s.commitHistory);
  const drag = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const snapshot = useRef<ReturnType<typeof useEditorStore.getState>['timeline']>(null);
  const moved = useRef(false);

  // 文本在舞台上的中心位置（显示空间）
  const cx = baseLeft + baseWidth / 2 + textClip.x * displayScale;
  const cy = baseTop + baseHeight / 2 + textClip.y * displayScale;
  // 拖拽框尺寸（文本大概区域，用于视觉指示）— 简化为固定 200x100
  const boxW = 200;
  const boxH = 100;
  const left = cx - boxW / 2;
  const top = cy - boxH / 2;

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    snapshot.current = useEditorStore.getState().timeline;
    moved.current = false;
    drag.current = { startX: e.clientX, startY: e.clientY, origX: textClip.x, origY: textClip.y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    moved.current = true;
    const dx = (e.clientX - d.startX) / displayScale;
    const dy = (e.clientY - d.startY) / displayScale;
    updateTextClip(textClip.id, { x: d.origX + dx, y: d.origY + dy });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (moved.current && snapshot.current) commitHistory(snapshot.current);
    drag.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      className="absolute cursor-move border-2 border-dashed border-indigo-400 bg-indigo-500/10"
      style={{ left, top, width: boxW, height: boxH }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
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
  const updateSettings = useEditorStore((s) => s.updateSettings);
  const { data: assets = [] } = useAssets();
  const audioUnlocked = useAudioUnlock();
  const stageRef = useRef<HTMLDivElement>(null);
  // 全屏时容器实际尺寸（用于重新计算 displayScale）
  const [containerSize, setContainerSize] = useState<{ w: number; h: number } | null>(null);
  // 预览区可用空间（非全屏），用于让舞台自适应而不挤压控制条。
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setViewport({ w: rect.width, h: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fps = timeline?.settings.fps ?? 30;
  const projectW = timeline?.settings.width ?? 1920;
  const projectH = timeline?.settings.height ?? 1080;
  const assetById = new Map(assets.map((a) => [a.id, a]));
  // 当前帧所有可见层（底→顶）。
  const layers = timeline ? findActiveLayers(timeline, currentFrame, assetById) : [];
  const hasVisual = layers.length > 0;

  // 预览舞台尺寸：按项目比例在可用空间内 object-contain。
  const projectAspect = projectW / projectH;
  // 非全屏用实测可用空间（回退到固定值），全屏用容器实际尺寸。
  let stageW = viewport?.w ?? MAX_PREVIEW_W;
  let stageH = viewport?.h ?? MAX_PREVIEW_H;
  // 全屏时用实际容器尺寸代替
  if (containerSize) {
    stageW = containerSize.w;
    stageH = containerSize.h;
  }
  if (projectAspect > stageW / stageH) {
    stageH = stageW / projectAspect;
  } else {
    stageW = stageH * projectAspect;
  }

  // 内容（object-contain）在 scale=1 时的显示尺寸与居中留白偏移。
  const contentScale = Math.min(stageW / projectW, stageH / projectH);
  const baseWidth = projectW * contentScale;
  const baseHeight = projectH * contentScale;
  const baseLeft = (stageW - baseWidth) / 2;
  const baseTop = (stageH - baseHeight) / 2;
  // transform.x/y 是项目像素，映射到舞台显示空间的比例。
  const displayScale = contentScale;

  // 选中片段若在当前可见层里，显示交互变换框（非全屏）。
  const selectedLayer = layers.find((l) => l.clip.id === selectedClipId);

  // 选中文本片段若当前帧可见，显示拖拽框（非全屏）。
  const selectedText = (() => {
    if (!timeline || !selectedClipId) return null;
    const f = Math.floor(currentFrame);
    for (const track of timeline.tracks) {
      if (track.kind === 'text' && track.textClips) {
        const tc = track.textClips.find(
          (tc) => tc.id === selectedClipId && f >= tc.start && f < tc.start + tc.durationInFrames,
        );
        if (tc) return tc;
      }
    }
    return null;
  })();

  /** 单层的 CSS transform（位移 + 缩放 + 旋转，围绕内容中心）。 */
  const layerTransform = (clip: Clip): string =>
    `translate(${clip.transform.x * displayScale}px, ${clip.transform.y * displayScale}px) scale(${clip.transform.scale}) rotate(${clip.transform.rotation}deg)`;

  const timecode = formatTimecode(currentFrame / fps);
  const totalTimecode = formatTimecode(totalFrames / fps);

  // 跟踪全屏状态：全屏时单击画面切换播放/暂停。
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFsChange = () => {
      const isFull = document.fullscreenElement === stageRef.current;
      setIsFullscreen(isFull);
      // 全屏时更新容器实际尺寸，用于重新计算 displayScale
      if (isFull && stageRef.current) {
        const rect = stageRef.current.getBoundingClientRect();
        setContainerSize({ w: rect.width, h: rect.height });
      } else {
        setContainerSize(null);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen();
  };

  // 切换项目比例：保持宽度 1920，调整高度以匹配选中比例。
  const setAspectRatio = (w: number, h: number) => {
    const newH = Math.round((1920 * h) / w);
    updateSettings({ width: 1920, height: newH });
  };

  const currentAspect = (projectW / projectH).toFixed(3);

  return (
    <div className="flex h-full flex-1 flex-col bg-base">
      {/* 音频混音：播放所有命中的音频片段（隐藏元素） */}
      {timeline && (
        <AudioMixer
          timeline={timeline}
          assetById={assetById}
          currentFrame={currentFrame}
          isPlaying={isPlaying}
          audioUnlocked={audioUnlocked}
        />
      )}
      {/* 比例选择器 */}
      <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2">
        <span className="text-xs text-fg-tertiary">画布比例</span>
        {ASPECT_RATIOS.map((ar) => {
          const arValue = (ar.w / ar.h).toFixed(3);
          const active = arValue === currentAspect;
          return (
            <button
              key={ar.label}
              onClick={() => setAspectRatio(ar.w, ar.h)}
              className={`rounded px-2 py-1 text-xs ${
                active
                  ? 'bg-accent text-white'
                  : 'bg-surface text-fg-secondary hover:bg-elevated'
              }`}
            >
              {ar.label}
            </button>
          );
        })}
        <span className="ml-auto text-xs tabular-nums text-fg-tertiary">
          {projectW} × {projectH}
        </span>
      </div>
      <div ref={viewportRef} className="flex min-h-0 flex-1 items-center justify-center p-8">
        <div
          ref={stageRef}
          onClick={() => isFullscreen && onTogglePlay()}
          className={`relative bg-black ${
            isFullscreen ? 'flex h-full w-full cursor-pointer items-center justify-center' : 'overflow-hidden rounded-lg border border-border-subtle'
          }`}
          style={isFullscreen ? undefined : { width: stageW, height: stageH }}
        >
          <div
            className="relative overflow-hidden"
            style={{ width: stageW, height: stageH }}
          >
          {/* 多层叠加：按图层顺序（底→顶）渲染每个命中片段，各自 transform/opacity */}
          {layers.map(({ clip, asset, track, transition }, i) => {
            // 转场区内用转场样式，否则用片段本身属性。
            const baseOpacity = clip.transform.opacity;
            const transitionOpacity = transition
              ? transition.role === 'from'
                ? transition.fromOpacity
                : transition.toOpacity
              : 1;
            const finalOpacity = baseOpacity * transitionOpacity;

            const baseTransform = layerTransform(clip);
            // 转场 transform 叠加在片段自身 transform 之后（slideleft 等）
            const transitionTransform =
              transition?.role === 'from' ? transition.fromTransform : transition?.role === 'to' ? transition.toTransform : undefined;
            const finalTransform = transitionTransform ? `${baseTransform} ${transitionTransform}` : baseTransform;

            const clipPath =
              transition?.role === 'from' ? transition.fromClip : transition?.role === 'to' ? transition.toClip : undefined;

            return asset.kind === 'image' ? (
              <img
                key={`${clip.id}-${i}`}
                src={asset.url!}
                alt={asset.name}
                className="absolute inset-0 h-full w-full object-contain"
                style={{
                  transform: finalTransform,
                  transformOrigin: 'center',
                  opacity: finalOpacity,
                  clipPath,
                  zIndex: i,
                }}
              />
            ) : (
              <div
                key={`${clip.id}-${i}`}
                className="absolute inset-0"
                style={{ zIndex: i, opacity: finalOpacity, clipPath, transform: transitionTransform, transformOrigin: 'center' }}
              >
                <VideoLayer
                  clip={clip}
                  asset={asset}
                  muted={track.muted || clip.transform.volume === 0}
                  volume={clip.transform.volume}
                  speed={clip.transform.speed}
                  fadeInDuration={clip.transform.fadeInDuration}
                  fadeOutDuration={clip.transform.fadeOutDuration}
                  fps={fps}
                  currentFrame={currentFrame}
                  isPlaying={isPlaying}
                  transform={baseTransform}
                />
              </div>
            );
          })}
          {/* 文本图层：当前帧命中的文本片段，叠加在视频之上 */}
          {timeline?.tracks
            .filter((t) => t.kind === 'text')
            .flatMap((t) => t.textClips ?? [])
            .filter((tc) => {
              const f = Math.floor(currentFrame);
              return f >= tc.start && f < tc.start + tc.durationInFrames;
            })
            .map((tc) => (
              <TextLayer
                key={tc.id}
                textClip={tc}
                displayScale={displayScale}
                baseLeft={baseLeft}
                baseTop={baseTop}
                baseWidth={baseWidth}
                baseHeight={baseHeight}
              />
            ))}
          {/* 交互式变换框（选中片段在可见层里、非全屏时） */}
          {selectedLayer && !isFullscreen && (
            <TransformBox
              clip={selectedLayer.clip}
              displayScale={displayScale}
              baseWidth={baseWidth}
              baseHeight={baseHeight}
              baseLeft={baseLeft}
              baseTop={baseTop}
            />
          )}
          {/* 文本拖拽框（选中文本片段且当前帧可见、非全屏时） */}
          {selectedText && !isFullscreen && (
            <TextDragBox
              textClip={selectedText}
              displayScale={displayScale}
              baseWidth={baseWidth}
              baseHeight={baseHeight}
              baseLeft={baseLeft}
              baseTop={baseTop}
            />
          )}
          {/* 无可见片段 / 纯音频 → 占位 */}
          {!hasVisual && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-tertiary">
              <span className="font-mono text-5xl font-bold text-input">{timecode}</span>
              <span className="text-[13px]">{timeline?.tracks.length ? '无视频片段' : '从左侧添加素材'}</span>
            </div>
          )}
          </div>
        </div>
      </div>

      <div className="grid h-13 grid-cols-[1fr_auto_1fr] items-center border-t border-border-subtle bg-surface px-5 py-3">
        {/* 左侧：时长 */}
        <span className="text-[13px] tabular-nums text-fg-secondary">{timecode} / {totalTimecode}</span>

        {/* 中间：播放控制（居中） */}
        <div className="flex items-center justify-center gap-[18px]">
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

        {/* 右侧：全屏按钮 */}
        <div className="flex justify-end">
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
