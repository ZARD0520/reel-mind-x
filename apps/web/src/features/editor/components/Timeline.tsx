import { useRef, useState } from 'react';
import {
  AudioLines,
  Copy,
  Eye,
  EyeOff,
  Film,
  GripVertical,
  Image as ImageIcon,
  Scissors,
  Trash2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Asset, Clip, Timeline as TimelineState, Track } from '@reel/contracts';
import {
  DEFAULT_ZOOM,
  framesToPx,
  nextZoom,
  pxToFrames,
  rulerTicks,
  ZOOM_LEVELS,
  zoomToPxPerSecond,
} from '../timeline';
import {
  MIN_FRAMES,
  others,
  resolveMove,
  resolveTrimLeft,
  resolveTrimRight,
} from '../collision';
import { useEditorStore } from '../store';

const VIDEO_TRACK_H = 60;
const AUDIO_TRACK_H = 44;
const TRACK_GAP = 8;
const RULER_H = 22;
const EDGE_WIDTH = 8; // 拖边缘 trim 的热区宽度（px）
const LEFT_W = 80; // 左侧轨道控制列宽度（px）

function tickLabel(sec: number): string {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function clipIcon(asset: Asset | undefined): LucideIcon {
  if (asset?.kind === 'audio') return AudioLines;
  if (asset?.kind === 'image') return ImageIcon;
  return Film;
}

// ─── ClipBlock ───────────────────────────────────────────────────────────────

type DragType = 'move' | 'trim-left' | 'trim-right';

interface DragState {
  type: DragType;
  startX: number;
  origStart: number;
  origDuration: number;
  origTrimStart: number;
  snapshot: TimelineState; // 拖拽前的整份 timeline，结束时入历史
  moved: boolean;
}

interface ClipBlockProps {
  clip: Clip;
  trackClips: Clip[];
  asset: Asset | undefined;
  fps: number;
  pxPerSecond: number;
  color: string;
  selected: boolean;
  onSelect: () => void;
}

function ClipBlock({
  clip,
  trackClips,
  asset,
  fps,
  pxPerSecond,
  color,
  selected,
  onSelect,
}: ClipBlockProps) {
  const Icon = clipIcon(asset);
  const updateClip = useEditorStore((s) => s.updateClip);
  const commitHistory = useEditorStore((s) => s.commitHistory);
  const drag = useRef<DragState | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, type: DragType) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const snapshot = useEditorStore.getState().timeline;
    if (!snapshot) return;
    drag.current = {
      type,
      startX: e.clientX,
      origStart: clip.start,
      origDuration: clip.durationInFrames,
      origTrimStart: clip.trimStart,
      snapshot,
      moved: false,
    };
    onSelect();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const { type, startX, origStart, origDuration, origTrimStart } = drag.current;
    const dFrames = pxToFrames(e.clientX - startX, fps, pxPerSecond);
    if (dFrames !== 0) drag.current.moved = true;
    const neighbors = others(trackClips, clip.id);

    if (type === 'move') {
      // 碰撞吸附：移动到不覆盖其他片段的最近合法位置。
      const newStart = resolveMove(origStart + dFrames, origDuration, neighbors);
      updateClip(clip.id, { start: newStart });
    } else if (type === 'trim-right') {
      const sourceMax = asset?.durationInFrames
        ? asset.durationInFrames - clip.trimStart
        : Infinity;
      const newDuration = resolveTrimRight(clip, neighbors, origDuration, dFrames, sourceMax);
      updateClip(clip.id, { durationInFrames: newDuration });
    } else {
      const next = resolveTrimLeft(
        clip,
        neighbors,
        { start: origStart, trimStart: origTrimStart, durationInFrames: origDuration },
        dFrames,
      );
      updateClip(clip.id, next);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    // 真正移动过才把 pre-drag 快照入历史（单纯点击不产生撤销步）。
    if (drag.current?.moved) commitHistory(drag.current.snapshot);
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const w = Math.max(
    framesToPx(clip.durationInFrames, fps, pxPerSecond),
    framesToPx(MIN_FRAMES, fps, pxPerSecond),
  );

  return (
    <div
      className={`absolute top-0 flex h-full select-none items-center overflow-hidden rounded-lg ${
        selected ? 'ring-2 ring-accent ring-offset-1 ring-offset-base' : ''
      }`}
      style={{
        left: framesToPx(clip.start, fps, pxPerSecond),
        width: w,
        backgroundColor: color,
        cursor: 'grab',
      }}
      onPointerDown={(e) => onPointerDown(e, 'move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 左边缘 trim 热区 */}
      <div
        className="absolute left-0 top-0 z-10 h-full cursor-ew-resize hover:bg-white/15"
        style={{ width: EDGE_WIDTH }}
        onPointerDown={(e) => onPointerDown(e, 'trim-left')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={(e) => e.stopPropagation()}
      />
      <div className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5">
        <Icon className="h-4 w-4 shrink-0 text-fg" />
        <span className="truncate text-xs font-medium text-fg">{asset?.name ?? '片段'}</span>
        {clip.transform.volume === 0 && (
          <VolumeX className="ml-auto h-3.5 w-3.5 shrink-0 text-fg/70" />
        )}
      </div>
      {/* 右边缘 trim 热区 */}
      <div
        className="absolute right-0 top-0 z-10 h-full cursor-ew-resize hover:bg-white/15"
        style={{ width: EDGE_WIDTH }}
        onPointerDown={(e) => onPointerDown(e, 'trim-right')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─── Timeline ────────────────────────────────────────────────────────────────

interface TimelineProps {
  timeline: TimelineState;
  assets: Asset[];
  currentFrame: number;
  selectedClipId: string | null;
  onSeek: (frame: number) => void;
  onSelectClip: (clipId: string | null) => void;
}

export function Timeline({
  timeline,
  assets,
  currentFrame,
  selectedClipId,
  onSeek,
  onSelectClip,
}: TimelineProps) {
  const {
    removeClip,
    splitClip,
    duplicateClip,
    addAsset,
    toggleTrackHidden,
    toggleTrackMuted,
    toggleClipMuted,
    moveTrack,
  } = useEditorStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const draggingTrack = useRef<{ idx: number; startY: number } | null>(null);
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);
  const pxPerSecond = zoomToPxPerSecond(zoom);

  const fps = timeline.settings.fps;
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const ticks = rulerTicks(timeline);
  const contentWidth = Math.max(800, LEFT_W + ticks[ticks.length - 1]! * pxPerSecond);
  const playheadLeft = LEFT_W + framesToPx(currentFrame, fps, pxPerSecond);

  const zoomBy = (dir: 1 | -1) => setZoom((z) => nextZoom(z, dir));

  const trackColor = (t: Track) =>
    t.kind === 'audio' ? 'var(--color-clip-audio)' : 'var(--color-clip-video)';
  const trackHeight = (t: Track) => (t.kind === 'audio' ? AUDIO_TRACK_H : VIDEO_TRACK_H);

  /** 由指针 clientX 推算时间轴帧（双向滚动 + 左列宽度） */
  const frameFromClientX = (clientX: number): number => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left + el.scrollLeft - LEFT_W;
    return Math.max(0, pxToFrames(x, fps, pxPerSecond));
  };

  const handleLaneClick = (e: React.MouseEvent<HTMLDivElement>) => {
    onSeek(frameFromClientX(e.clientX));
    onSelectClip(null);
  };

  // 播放头拖拽（scrub）。
  const onPlayheadDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbing.current = true;
    onSeek(frameFromClientX(e.clientX));
  };
  const onPlayheadMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbing.current) return;
    onSeek(frameFromClientX(e.clientX));
  };
  const onPlayheadUp = (e: React.PointerEvent<HTMLDivElement>) => {
    scrubbing.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // 轨道拖拽排序：拖动左侧 grip，松手时按指针所在行计算目标索引。
  const onTrackDragStart = (e: React.PointerEvent, idx: number) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    draggingTrack.current = { idx, startY: e.clientY };
  };
  const onTrackDragEnd = (e: React.PointerEvent) => {
    const d = draggingTrack.current;
    draggingTrack.current = null;
    if (!d) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    // 命中目标行：找指针 Y 落在哪个轨道控制块上。
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el?.closest('[data-track-idx]') as HTMLElement | null;
    if (!row) return;
    const to = Number(row.dataset.trackIdx);
    if (!Number.isNaN(to) && to !== d.idx) moveTrack(d.idx, to);
  };

  const canSplit = !!selectedClipId;
  const selectedClip = selectedClipId
    ? timeline.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId)
    : undefined;
  const playheadHeight =
    RULER_H + timeline.tracks.reduce((h, t) => h + TRACK_GAP + trackHeight(t), 0);

  // ─── 拖放：从左侧素材拖到时间轴 ───
  const [dropNewActive, setDropNewActive] = useState(false);
  const assetFromDrag = (e: React.DragEvent): Asset | undefined => {
    const id = e.dataTransfer.getData('application/x-reel-asset');
    return assets.find((a) => a.id === id);
  };
  const allowDrop = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-reel-asset')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  // 拖到某轨道泳道：放到该轨该帧。
  const onDropToTrack = (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const asset = assetFromDrag(e);
    if (asset) addAsset(asset, { trackId, atFrame: frameFromClientX(e.clientX) });
  };
  // 拖到底部空白：新建一轨,放到最底层（数组开头＝时间轴最下面一行，不盖住现有内容）。
  const onDropToNew = (e: React.DragEvent) => {
    e.preventDefault();
    setDropNewActive(false);
    const asset = assetFromDrag(e);
    if (asset) {
      addAsset(asset, {
        newTrackAt: 0,
        atFrameForNew: frameFromClientX(e.clientX),
      });
    }
  };

  return (
    <div className="flex h-[250px] flex-col border-t border-border-subtle bg-surface">
      {/* 工具栏 */}
      <div className="flex h-11 items-center justify-between border-b border-border-subtle px-4">
        <div className="flex items-center gap-1">
          <button
            title="在播放头处分割"
            disabled={!canSplit}
            onClick={() => selectedClipId && splitClip(selectedClipId, currentFrame)}
            className={`flex h-[30px] w-[30px] items-center justify-center rounded-md transition-colors ${
              canSplit ? 'text-fg-secondary hover:bg-elevated' : 'text-fg-tertiary opacity-40'
            }`}
          >
            <Scissors className="h-4 w-4" />
          </button>
          <button
            title="复制片段"
            disabled={!selectedClipId}
            onClick={() => selectedClipId && duplicateClip(selectedClipId)}
            className={`flex h-[30px] w-[30px] items-center justify-center rounded-md transition-colors ${
              selectedClipId ? 'text-fg-secondary hover:bg-elevated' : 'text-fg-tertiary opacity-40'
            }`}
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            title="删除片段"
            disabled={!selectedClipId}
            onClick={() => selectedClipId && removeClip(selectedClipId)}
            className={`flex h-[30px] w-[30px] items-center justify-center rounded-md transition-colors ${
              selectedClipId ? 'text-red-400 hover:bg-red-400/10' : 'text-fg-tertiary opacity-40'
            }`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            title="片段静音/取消静音"
            disabled={!selectedClipId}
            onClick={() => selectedClipId && toggleClipMuted(selectedClipId)}
            className={`flex h-[30px] w-[30px] items-center justify-center rounded-md transition-colors ${
              selectedClipId ? 'text-fg-secondary hover:bg-elevated' : 'text-fg-tertiary opacity-40'
            }`}
          >
            {selectedClip?.transform.volume === 0 ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </button>
        </div>
        <div className="flex items-center gap-2.5 text-fg-secondary">
          <button
            title="缩小"
            onClick={() => zoomBy(-1)}
            disabled={zoom <= ZOOM_LEVELS[0]!}
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-elevated disabled:opacity-40"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            title="重置为 100%"
            onClick={() => setZoom(DEFAULT_ZOOM)}
            className="w-11 text-center text-[11px] tabular-nums text-fg-tertiary hover:text-fg-secondary"
          >
            {zoom}%
          </button>
          <button
            title="放大"
            onClick={() => zoomBy(1)}
            disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!}
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-elevated disabled:opacity-40"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 轨道区（双向滚动；左列与刻度尺分别 sticky 固定） */}
      <div ref={scrollRef} className="timeline-scroll relative flex-1 overflow-auto">
        <div className="relative" style={{ width: contentWidth, minHeight: playheadHeight + 8 }}>
          {/* 刻度尺行：sticky 顶部，纵滚不消失 */}
          <div
            className="sticky top-0 z-30 flex bg-surface"
            style={{ width: contentWidth, height: RULER_H }}
          >
            {/* 左上角占位（盖住左列上方） */}
            <div className="sticky left-0 z-10 shrink-0 bg-surface" style={{ width: LEFT_W }} />
            {/* 刻度（兼作 scrub 热区） */}
            <div
              className="relative shrink-0 cursor-pointer"
              style={{ width: contentWidth - LEFT_W }}
              onPointerDown={onPlayheadDown}
              onPointerMove={onPlayheadMove}
              onPointerUp={onPlayheadUp}
              onClick={(e) => e.stopPropagation()}
            >
              {ticks.map((sec) => (
                <span
                  key={sec}
                  className="pointer-events-none absolute top-1 text-[11px] text-fg-tertiary"
                  style={{ left: sec * pxPerSecond }}
                >
                  {tickLabel(sec)}
                </span>
              ))}
              {/* 播放头三角手柄：在 sticky 刻度尺内，纵滚时固定在顶部不消失 */}
              {timeline.tracks.length > 0 && (
                <div
                  className="absolute z-40 h-0 w-0 -translate-x-1/2 cursor-ew-resize border-x-[7px] border-t-[10px] border-x-transparent border-t-accent"
                  style={{ left: framesToPx(currentFrame, fps, pxPerSecond), top: -1 }}
                  onPointerDown={onPlayheadDown}
                  onPointerMove={onPlayheadMove}
                  onPointerUp={onPlayheadUp}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </div>
          </div>

          {/* 轨道行 */}
          {timeline.tracks.length === 0 ? (
            <div
              className={`mx-2 mt-2 flex h-[60px] items-center justify-center rounded-lg border border-dashed ${
                dropNewActive ? 'border-accent bg-accent/10' : 'border-border-subtle'
              } text-[13px] text-fg-tertiary transition-colors`}
              style={{ width: contentWidth - 16 }}
              onDragOver={(e) => { allowDrop(e); setDropNewActive(true); }}
              onDragLeave={() => setDropNewActive(false)}
              onDrop={onDropToNew}
            >
              拖左侧素材到这里
            </div>
          ) : (
            <>
              {/* 倒序渲染：数组末尾＝顶层＝时间轴最上面一行，与预览「顶层优先」一致。
                  data-track-idx 仍存真实数组索引，供拖拽排序用。 */}
              {timeline.tracks
                .map((track, idx) => ({ track, idx }))
                .reverse()
                .map(({ track, idx }) => {
                  const isAudio = track.kind === 'audio';
                  const off = isAudio ? track.muted : track.hidden;
                  return (
                    <div
                      key={track.id}
                      data-track-idx={idx}
                      className="relative mt-2 flex"
                      style={{ width: contentWidth, height: trackHeight(track) }}
                    >
                      {/* 左列：轨道控制（sticky 左固定，不占时间轨道；右留 8px 间距） */}
                    <div
                      className={`sticky left-0 z-20 mr-2 flex shrink-0 items-center gap-1 rounded-md border border-border-subtle bg-elevated px-1.5 ${
                        off ? 'opacity-50' : ''
                      }`}
                      style={{ width: LEFT_W - 8 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* 拖拽手柄（排序） */}
                      <div
                        title="拖动排序"
                        className="flex h-full cursor-grab items-center text-fg-tertiary hover:text-fg-secondary"
                        onPointerDown={(e) => onTrackDragStart(e, idx)}
                        onPointerUp={onTrackDragEnd}
                      >
                        <GripVertical className="h-4 w-4" />
                      </div>
                      {/* 眼睛(视频)/喇叭(音频) 垂直居中 */}
                      {isAudio ? (
                        <button
                          title={track.muted ? '取消静音' : '静音'}
                          onClick={() => toggleTrackMuted(track.id)}
                          className="flex h-7 w-7 items-center justify-center rounded text-fg-secondary hover:bg-surface"
                        >
                          {track.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                        </button>
                      ) : (
                        <button
                          title={track.hidden ? '显示轨道' : '隐藏轨道'}
                          onClick={() => toggleTrackHidden(track.id)}
                          className="flex h-7 w-7 items-center justify-center rounded text-fg-secondary hover:bg-surface"
                        >
                          {track.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      )}
                    </div>
                    {/* 右侧泳道：片段（接受拖放） */}
                    <div
                      className={`relative shrink-0 ${off ? 'opacity-40' : ''}`}
                      style={{ width: contentWidth - LEFT_W }}
                      onClick={handleLaneClick}
                      onDragOver={allowDrop}
                      onDrop={(e) => onDropToTrack(e, track.id)}
                    >
                      {track.clips.map((clip) => (
                        <ClipBlock
                          key={clip.id}
                          clip={clip}
                          trackClips={track.clips}
                          asset={assetById.get(clip.assetId)}
                          fps={fps}
                          pxPerSecond={pxPerSecond}
                          color={trackColor(track)}
                          selected={clip.id === selectedClipId}
                          onSelect={() => onSelectClip(clip.id)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
              {/* 底部拖放区：拖到这创建新轨道 */}
              <div
                className={`mx-2 mt-2 flex h-12 items-center justify-center rounded-lg border border-dashed ${
                  dropNewActive ? 'border-accent bg-accent/10' : 'border-border-subtle'
                } text-[13px] text-fg-tertiary transition-colors`}
                style={{ width: contentWidth - 16 }}
                onDragOver={(e) => { allowDrop(e); setDropNewActive(true); }}
                onDragLeave={() => setDropNewActive(false)}
                onDrop={onDropToNew}
              >
                拖到这里新建轨道（多层）
              </div>
            </>
          )}

          {/* 播放头竖线（横跨所有轨道；手柄在上方 sticky 刻度尺内） */}
          {timeline.tracks.length > 0 && (
            <div
              className="pointer-events-none absolute top-0 z-40 w-0.5 -translate-x-1/2 bg-accent"
              style={{ left: playheadLeft, height: playheadHeight }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
