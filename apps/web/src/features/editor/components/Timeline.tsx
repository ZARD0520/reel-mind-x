import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Copy,
  Eye,
  EyeOff,
  Film,
  GripVertical,
  Image as ImageIcon,
  Magnet,
  Scissors,
  Trash2,
  Type,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Asset, Clip, TextClip, Timeline as TimelineState, Track } from '@reel/contracts';
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

/** 全局拖拽状态（Timeline 统一管理，ClipBlock 更新，ghost 由 Timeline 渲染） */
interface GlobalDragState {
  type: DragType;
  clipId: string;
  trackId: string;
  trackKind: 'video' | 'audio' | 'text';
  startX: number;
  startY: number;
  origStart: number;
  origDuration: number;
  origTrimStart: number;
  snapshot: TimelineState;
  ghostStart: number;
  candidateTrackId: string | null;
  moved: boolean;
  /** pointerDown 时鼠标在片段内的相对偏移（像素，用于 ghost 以鼠标为中心） */
  pointerOffsetPx: number;
  /** 吸附辅助线的帧位置（吸附到播放头/片段边缘时显示竖线），null=未吸附 */
  snapLineFrame: number | null;
  // clip rendering data for ghost
  color: string;
  assetName: string;
  assetKind: 'video' | 'audio' | 'image';
}

interface ClipBlockProps {
  clip: Clip;
  trackId: string;
  trackKind: 'video' | 'audio';
  trackClips: Clip[];
  asset: Asset | undefined;
  fps: number;
  pxPerSecond: number;
  color: string;
  selected: boolean;
  currentFrame: number; // 播放头位置（吸附用）
  snapEnabled: boolean; // 磁吸开关
  onSelect: () => void;
  // 拖拽回调（Timeline 统一管理，ClipBlock 上报）
  onDragStart: (drag: GlobalDragState) => void;
  onDragMove: (update: Partial<Pick<GlobalDragState, 'ghostStart' | 'candidateTrackId' | 'snapLineFrame'>>) => void;
  onDragEnd: () => void;
}

function ClipBlock({
  clip,
  trackId,
  trackKind,
  trackClips,
  asset,
  fps,
  pxPerSecond,
  color,
  selected,
  currentFrame,
  snapEnabled,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
}: ClipBlockProps) {
  const Icon = clipIcon(asset);
  const updateClip = useEditorStore((s) => s.updateClip);
  const commitHistory = useEditorStore((s) => s.commitHistory);
  const drag = useRef<GlobalDragState | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, type: DragType) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const snapshot = useEditorStore.getState().timeline;
    if (!snapshot) return;
    // 计算鼠标在片段内的相对偏移（px），用于 ghost 居中跟随。
    const rect = e.currentTarget.getBoundingClientRect();
    const pointerOffsetPx = e.clientX - rect.left;
    const d: GlobalDragState = {
      type,
      clipId: clip.id,
      trackId,
      trackKind,
      startX: e.clientX,
      startY: e.clientY,
      origStart: clip.start,
      origDuration: clip.durationInFrames,
      origTrimStart: clip.trimStart,
      snapshot,
      moved: false,
      candidateTrackId: trackId,
      ghostStart: clip.start,
      pointerOffsetPx,
      snapLineFrame: null,
      color,
      assetName: asset?.name ?? '片段',
      assetKind: asset?.kind ?? 'video',
    };
    drag.current = d;
    // 不在 pointerDown 时立即显示 ghost，等真正 moved 时才显示（onPointerMove 里调 onDragStart）。
    onSelect();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const { type, startX, origStart, origDuration, origTrimStart } = drag.current;
    const dFrames = pxToFrames(e.clientX - startX, fps, pxPerSecond);
    const wasMoved = drag.current.moved;
    if (dFrames !== 0) drag.current.moved = true;
    const neighbors = others(trackClips, clip.id);

    // 收集吸附目标（帧）：播放头 + 目标轨各片段 start/end。
    const collectSnapTargets = (forTrackId: string): number[] => {
      const targets: number[] = [currentFrame, 0];
      const tl = useEditorStore.getState().timeline;
      const tk = tl?.tracks.find((t) => t.id === forTrackId);
      tk?.clips.forEach((c) => {
        if (c.id !== clip.id) targets.push(c.start, c.start + c.durationInFrames);
      });
      return targets;
    };
    const snapPxToFrames = pxToFrames(8, fps, pxPerSecond); // 8px 吸附阈值

    if (type === 'move') {
      // 检测指针命中哪个轨道（跨轨迁移）。
      const lanes = document.querySelectorAll<HTMLDivElement>('[data-track-id]');
      let targetTrackId = trackId;
      for (const lane of lanes) {
        const rect = lane.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX < rect.right && e.clientY >= rect.top && e.clientY < rect.bottom) {
          const tkind = lane.getAttribute('data-track-kind');
          if (tkind === trackKind) targetTrackId = lane.getAttribute('data-track-id') ?? trackId;
          break;
        }
      }
      drag.current.candidateTrackId = targetTrackId;

      // 磁吸：片段左/右边缘靠近目标点就吸（实时作用到真实片段）。
      const raw = Math.max(0, origStart + dFrames);
      let snappedStart = raw;
      let snapLine: number | null = null;
      if (snapEnabled) {
        const targets = collectSnapTargets(targetTrackId);
        let best = snapPxToFrames + 1;
        for (const t of targets) {
          const dL = Math.abs(raw - t);
          if (dL < best) { best = dL; snappedStart = t; snapLine = t; }
          const dR = Math.abs(raw + origDuration - t);
          if (dR < best) { best = dR; snappedStart = Math.max(0, t - origDuration); snapLine = t; }
        }
        if (best > snapPxToFrames) snapLine = null; // 没吸附到就清空
      }
      drag.current.ghostStart = snappedStart;
      drag.current.snapLineFrame = snapLine;

      // 同轨：实时移动真实片段（剪映感），但要碰撞检测避免重叠。
      if (targetTrackId === trackId) {
        if (!wasMoved && drag.current.moved) onDragStart(drag.current);
        // 碰撞检测：snappedStart 可能让片段覆盖邻居，用 resolveMove 约束到合法位置。
        const safeStart = resolveMove(snappedStart, origDuration, neighbors);
        updateClip(clip.id, { start: safeStart });
        // 上报 snapLine（即使碰撞约束后位置变了，黄线还是显示吸附目标）
        onDragMove({ ghostStart: safeStart, candidateTrackId: targetTrackId, snapLineFrame: snapLine });
      } else {
        if (!wasMoved && drag.current.moved) onDragStart(drag.current);
        // 跨轨：真实片段回原位，ghost 预览。
        updateClip(clip.id, { start: origStart });
        onDragMove({ ghostStart: snappedStart, candidateTrackId: targetTrackId, snapLineFrame: snapLine });
      }
    } else if (type === 'trim-right') {
      // 第一次移动时触发 dragStart（渲染黄线需要 globalDrag）
      if (!wasMoved && drag.current.moved) onDragStart(drag.current);
      const sourceMax = asset?.durationInFrames ? asset.durationInFrames - clip.trimStart : Infinity;
      let newDuration = resolveTrimRight(clip, neighbors, origDuration, dFrames, sourceMax);
      // trim-right 磁吸：右边缘（start+duration）靠近目标就吸。
      let snapLine: number | null = null;
      if (snapEnabled) {
        const targets = collectSnapTargets(trackId);
        const rightEdge = clip.start + newDuration;
        for (const t of targets) {
          if (Math.abs(rightEdge - t) <= snapPxToFrames) {
            newDuration = Math.max(MIN_FRAMES, t - clip.start);
            snapLine = t;
            break;
          }
        }
      }
      drag.current.snapLineFrame = snapLine;
      onDragMove({ ghostStart: clip.start, candidateTrackId: trackId, snapLineFrame: snapLine });
      updateClip(clip.id, { durationInFrames: newDuration });
    } else {
      // 第一次移动时触发 dragStart
      if (!wasMoved && drag.current.moved) onDragStart(drag.current);
      let next = resolveTrimLeft(
        clip,
        neighbors,
        { start: origStart, trimStart: origTrimStart, durationInFrames: origDuration },
        dFrames,
      );
      // trim-left 磁吸：左边缘（start）靠近目标就吸。
      let snapLine: number | null = null;
      if (snapEnabled) {
        const targets = collectSnapTargets(trackId);
        for (const t of targets) {
          if (Math.abs(next.start - t) <= snapPxToFrames) {
            const delta = t - origStart;
            next = {
              start: t,
              trimStart: origTrimStart + delta,
              durationInFrames: origDuration - delta,
            };
            snapLine = t;
            break;
          }
        }
      }
      drag.current.snapLineFrame = snapLine;
      onDragMove({ ghostStart: clip.start, candidateTrackId: trackId, snapLineFrame: snapLine });
      updateClip(clip.id, next);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current) {
      const { moved, type, candidateTrackId } = drag.current;

      if (type === 'move') {
        if (moved) {
          if (candidateTrackId && candidateTrackId !== trackId) {
            // 跨轨：迁移到目标轨的拖拽落点。
            onDragEnd();
          } else {
            // 同轨：已实时移动，提交历史即可。
            commitHistory(drag.current.snapshot);
            onDragEnd();
          }
        } else {
          onDragEnd(); // 清理 ghost 状态
        }
      } else {
        // trim 提交历史。
        if (moved) commitHistory(drag.current.snapshot);
        onDragEnd();
      }

      drag.current = null;
    }
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

// ─── TextClipBlock（文本片段块，支持移动 + trim 调时长） ───────────────────────

interface TextClipBlockProps {
  textClip: TextClip;
  trackId: string;
  trackTextClips: TextClip[];
  fps: number;
  pxPerSecond: number;
  selected: boolean;
  currentFrame: number;
  snapEnabled: boolean;
  onSelect: () => void;
  onDragStart: (drag: GlobalDragState) => void;
  onDragMove: (update: Partial<Pick<GlobalDragState, 'ghostStart' | 'candidateTrackId' | 'snapLineFrame'>>) => void;
  onDragEnd: () => void;
}

function TextClipBlock({
  textClip,
  trackId,
  trackTextClips,
  fps,
  pxPerSecond,
  selected,
  currentFrame,
  snapEnabled,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
}: TextClipBlockProps) {
  const updateTextClip = useEditorStore((s) => s.updateTextClip);
  const commitHistory = useEditorStore((s) => s.commitHistory);
  const drag = useRef<GlobalDragState | null>(null);

  const w = Math.max(20, framesToPx(textClip.durationInFrames, fps, pxPerSecond));
  const left = framesToPx(textClip.start, fps, pxPerSecond);
  const active = currentFrame >= textClip.start && currentFrame < textClip.start + textClip.durationInFrames;

  // 收集磁吸目标：播放头 + 0 点 + 目标文本轨其它文本片段的 start/end
  //                + 所有视频/音频轨片段的 start/end（文本可对齐到镜头/音频的始末）
  const collectSnapTargets = (forTrackId: string): number[] => {
    const targets = [currentFrame, 0];
    const tl = useEditorStore.getState().timeline;
    if (!tl) return targets;
    for (const tk of tl.tracks) {
      if (tk.kind === 'text') {
        // 仅目标文本轨内的其它文本片段参与对齐（排除自己）。
        if (tk.id !== forTrackId) continue;
        for (const tc of tk.textClips ?? []) {
          if (tc.id !== textClip.id) targets.push(tc.start, tc.start + tc.durationInFrames);
        }
      } else {
        // 视频/音频轨：所有片段的始末都作为对齐点。
        for (const c of tk.clips) targets.push(c.start, c.start + c.durationInFrames);
      }
    }
    return targets;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, type: 'move' | 'trim-left' | 'trim-right') => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const snapshot = useEditorStore.getState().timeline;
    if (!snapshot) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const d: GlobalDragState = {
      type,
      clipId: textClip.id,
      trackId,
      trackKind: 'text',
      startX: e.clientX,
      startY: e.clientY,
      origStart: textClip.start,
      origDuration: textClip.durationInFrames,
      origTrimStart: 0,
      snapshot,
      moved: false,
      candidateTrackId: trackId,
      ghostStart: textClip.start,
      pointerOffsetPx: e.clientX - rect.left,
      snapLineFrame: null,
      color: '#6366F1',
      assetName: textClip.text.substring(0, 20),
      assetKind: 'image',
    };
    drag.current = d;
    onSelect();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const { type, startX, origStart, origDuration } = drag.current;
    const dFrames = pxToFrames(e.clientX - startX, fps, pxPerSecond);
    const wasMoved = drag.current.moved;
    if (dFrames !== 0) drag.current.moved = true;

    const snapPxToFrames = pxToFrames(8, fps, pxPerSecond);

    if (type === 'move') {
      // 检测指针命中哪个文本轨道（跨轨迁移）
      const lanes = document.querySelectorAll<HTMLDivElement>('[data-track-id]');
      let targetTrackId = trackId;
      for (const lane of lanes) {
        const rect = lane.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX < rect.right && e.clientY >= rect.top && e.clientY < rect.bottom) {
          const tkind = lane.getAttribute('data-track-kind');
          if (tkind === 'text') targetTrackId = lane.getAttribute('data-track-id') ?? trackId;
          break;
        }
      }
      drag.current.candidateTrackId = targetTrackId;

      const raw = Math.max(0, origStart + dFrames);
      let snappedStart = raw;
      let snapLine: number | null = null;

      if (snapEnabled) {
        const targets = collectSnapTargets(targetTrackId);
        let best = snapPxToFrames + 1;
        for (const t of targets) {
          const dL = Math.abs(raw - t);
          if (dL < best) { best = dL; snappedStart = t; snapLine = t; }
          const dR = Math.abs(raw + origDuration - t);
          if (dR < best) { best = dR; snappedStart = Math.max(0, t - origDuration); snapLine = t; }
        }
        if (best > snapPxToFrames) snapLine = null;
      }

      drag.current.ghostStart = snappedStart;
      drag.current.snapLineFrame = snapLine;

      // 同轨：实时移动真实片段（碰撞检测避免重叠）
      if (targetTrackId === trackId) {
        if (!wasMoved && drag.current.moved) onDragStart(drag.current);
        const neighbors = trackTextClips.filter((tc) => tc.id !== textClip.id);
        const safeStart = resolveMove(snappedStart, origDuration, neighbors);
        updateTextClip(textClip.id, { start: safeStart });
        onDragMove({ ghostStart: safeStart, candidateTrackId: targetTrackId, snapLineFrame: snapLine });
      } else {
        // 跨轨：真实片段回原位，ghost 预览
        if (!wasMoved && drag.current.moved) onDragStart(drag.current);
        updateTextClip(textClip.id, { start: origStart });
        onDragMove({ ghostStart: snappedStart, candidateTrackId: targetTrackId, snapLineFrame: snapLine });
      }
    } else if (type === 'trim-right') {
      // trim-right：右边缘右拉增加时长，左拉减少时长（最小 MIN_FRAMES）
      let newDuration = Math.max(MIN_FRAMES, origDuration + dFrames);
      let snapLine: number | null = null;

      if (snapEnabled) {
        const targets = collectSnapTargets(trackId);
        const rightEdge = textClip.start + newDuration;
        for (const t of targets) {
          if (Math.abs(rightEdge - t) <= snapPxToFrames) {
            newDuration = Math.max(MIN_FRAMES, t - textClip.start);
            snapLine = t;
            break;
          }
        }
      }

      drag.current.snapLineFrame = snapLine;
      if (!wasMoved && drag.current.moved) onDragStart(drag.current);
      onDragMove({ ghostStart: textClip.start, candidateTrackId: trackId, snapLineFrame: snapLine });
      updateTextClip(textClip.id, { durationInFrames: newDuration });
    } else {
      // trim-left：左边缘右拉减少时长（增加 start），左拉增加时长（减少 start）
      const newStart = Math.max(0, origStart + dFrames);
      let newDuration = Math.max(MIN_FRAMES, origDuration - dFrames);
      let snapLine: number | null = null;

      if (snapEnabled) {
        const targets = collectSnapTargets(trackId);
        for (const t of targets) {
          if (Math.abs(newStart - t) <= snapPxToFrames) {
            const clampedStart = t;
            newDuration = Math.max(MIN_FRAMES, origStart + origDuration - clampedStart);
            updateTextClip(textClip.id, { start: clampedStart, durationInFrames: newDuration });
            snapLine = t;
            drag.current.snapLineFrame = snapLine;
            if (!wasMoved && drag.current.moved) onDragStart(drag.current);
            onDragMove({ ghostStart: clampedStart, candidateTrackId: trackId, snapLineFrame: snapLine });
            return;
          }
        }
      }

      drag.current.snapLineFrame = snapLine;
      if (!wasMoved && drag.current.moved) onDragStart(drag.current);
      onDragMove({ ghostStart: newStart, candidateTrackId: trackId, snapLineFrame: snapLine });
      updateTextClip(textClip.id, { start: newStart, durationInFrames: newDuration });
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current) {
      const { moved, candidateTrackId } = drag.current;
      if (moved) {
        if (candidateTrackId && candidateTrackId !== trackId) {
          // 跨轨：迁移到目标轨
          onDragEnd();
        } else {
          // 同轨：已实时移动，提交历史即可
          commitHistory(drag.current.snapshot);
          onDragEnd();
        }
      } else {
        onDragEnd();
      }
    }
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      className={`absolute flex cursor-grab items-center overflow-hidden rounded border px-2 ${
        selected
          ? 'border-accent bg-indigo-500/90 shadow-md'
          : active
            ? 'border-indigo-400 bg-indigo-500/80'
            : 'border-indigo-600 bg-indigo-500/70'
      }`}
      style={{ left, width: w, height: VIDEO_TRACK_H - 4 }}
      onPointerDown={(e) => onPointerDown(e, 'move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 左边缘 trim 热区 */}
      <div
        className="absolute left-0 top-0 z-10 h-full w-2 cursor-ew-resize hover:bg-white/15"
        onPointerDown={(e) => onPointerDown(e, 'trim-left')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={(e) => e.stopPropagation()}
      />
      <span className="truncate text-xs font-medium text-white">{textClip.text}</span>
      {/* 右边缘 trim 热区 */}
      <div
        className="absolute right-0 top-0 z-10 h-full w-2 cursor-ew-resize hover:bg-white/15"
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
    insertClipAndPush,
  } = useEditorStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const draggingTrack = useRef<{ idx: number; startY: number } | null>(null);
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);
  const [snapEnabled, setSnapEnabled] = useState(true); // 磁吸开关，默认开
  const pxPerSecond = zoomToPxPerSecond(zoom);

  // 全局拖拽状态（替代 ClipBlock 内部 ref，支持全局 ghost 渲染）
  const [globalDrag, setGlobalDrag] = useState<GlobalDragState | null>(null);

  const fps = timeline.settings.fps;
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const ticks = rulerTicks(timeline, pxPerSecond);
  const lastTickSec = ticks.length ? ticks[ticks.length - 1]!.sec : 30;
  const contentWidth = Math.max(800, LEFT_W + lastTickSec * pxPerSecond);
  const playheadLeft = LEFT_W + framesToPx(currentFrame, fps, pxPerSecond);

  const zoomBy = (dir: 1 | -1) => setZoom((z) => nextZoom(z, dir));

  const trackColor = (t: Track) =>
    t.kind === 'audio' ? 'var(--color-clip-audio)' : 'var(--color-clip-video)';
  const trackHeight = (t: Track) =>
    t.kind === 'audio' ? AUDIO_TRACK_H : t.kind === 'text' ? VIDEO_TRACK_H : VIDEO_TRACK_H;

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

  // ─── 片段拖拽（剪映式：真实片段不动，全局 ghost 跟随，松手落位+推挤） ───
  const dragRef = useRef<GlobalDragState | null>(null);
  const lastPointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleDragStart = (d: GlobalDragState) => {
    dragRef.current = d;
    setGlobalDrag(d);
  };
  const handleDragMove = (
    update: Partial<Pick<GlobalDragState, 'ghostStart' | 'candidateTrackId' | 'snapLineFrame'>>,
  ) => {
    if (!dragRef.current) return;
    dragRef.current = { ...dragRef.current, ...update, moved: true };
    setGlobalDrag(dragRef.current);
  };
  const handleDragEnd = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setGlobalDrag(null);
    if (!d) return;

    const isText = d.trackKind === 'text';

    // 松手在"新建轨道"区域？
    const overNew = document
      .elementFromPoint(lastPointer.current.x, lastPointer.current.y)
      ?.closest('[data-newtrack-zone]');
    if (overNew) {
      if (isText) {
        useEditorStore.getState().relocateTextClipToNewTrack(d.clipId);
      } else {
        useEditorStore.getState().relocateClipToNewTrack(d.clipId);
      }
      return;
    }

    const targetTrackId = d.candidateTrackId ?? d.trackId;
    // 同轨：已在 onPointerMove 实时移动并在 onPointerUp commit，无需再处理。
    if (targetTrackId === d.trackId) return;

    // 跨轨：迁移到目标轨的 ghostStart 位置（已磁吸）。
    const proposed = Math.max(0, Math.round(d.ghostStart));
    if (isText) {
      useEditorStore.getState().relocateTextClip(d.clipId, targetTrackId, proposed);
    } else {
      useEditorStore.getState().relocateClip(d.clipId, targetTrackId, proposed);
    }
  };

  // 拖拽中跟踪鼠标位置（用于松手时命中检测 + ghost 的 Y 定位）。
  useEffect(() => {
    if (!globalDrag) return;
    const onMove = (e: PointerEvent) => {
      lastPointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [globalDrag]);

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
  // 仅 media 片段（含 transform）；文本片段无 transform，静音按钮对其不生效。
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
          <button
            title={snapEnabled ? '禁用磁吸' : '启用磁吸'}
            onClick={() => setSnapEnabled((s) => !s)}
            className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-elevated ${
              snapEnabled ? 'text-accent' : 'text-fg-secondary'
            }`}
          >
            <Magnet className="h-4 w-4" />
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
              {ticks.map((tick) => (
                <div key={tick.sec} className="pointer-events-none absolute top-0 h-full" style={{ left: tick.sec * pxPerSecond }}>
                  {tick.major ? (
                    <>
                      {/* 主刻度：竖线 + 时间标签 */}
                      <div className="absolute bottom-0 h-2.5 w-px bg-fg-tertiary" />
                      <span className="absolute top-0 left-1 text-[10px] text-fg-tertiary">{tickLabel(tick.sec)}</span>
                    </>
                  ) : (
                    // 次刻度：短竖线
                    <div className="absolute bottom-0 h-1.5 w-px bg-fg-tertiary opacity-40" />
                  )}
                </div>
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
                  const isText = track.kind === 'text';
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
                      {/* 图标：文本/音频/视频 */}
                      {isText ? (
                        <Type className="h-4 w-4 text-indigo-400" />
                      ) : isAudio ? (
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
                    {/* 右侧泳道：片段（接受拖放 + 跨轨迁移） */}
                    <div
                      data-track-id={track.id}
                      data-track-kind={track.kind}
                      className={`relative shrink-0 ${off ? 'opacity-40' : ''}`}
                      style={{ width: contentWidth - LEFT_W }}
                      onClick={handleLaneClick}
                      onDragOver={allowDrop}
                      onDrop={(e) => onDropToTrack(e, track.id)}
                    >
                      {isText
                        ? (track.textClips ?? []).map((tc) => (
                            <TextClipBlock
                              key={tc.id}
                              textClip={tc}
                              trackId={track.id}
                              trackTextClips={track.textClips ?? []}
                              fps={fps}
                              pxPerSecond={pxPerSecond}
                              selected={tc.id === selectedClipId}
                              currentFrame={currentFrame}
                              snapEnabled={snapEnabled}
                              onSelect={() => onSelectClip(tc.id)}
                              onDragStart={handleDragStart}
                              onDragMove={handleDragMove}
                              onDragEnd={handleDragEnd}
                            />
                          ))
                        : track.clips.map((clip) => (
                        <ClipBlock
                          key={clip.id}
                          clip={clip}
                          trackId={track.id}
                          trackKind={track.kind as 'video' | 'audio'}
                          trackClips={track.clips}
                          asset={assetById.get(clip.assetId)}
                          fps={fps}
                          pxPerSecond={pxPerSecond}
                          color={trackColor(track)}
                          selected={clip.id === selectedClipId}
                          currentFrame={currentFrame}
                          snapEnabled={snapEnabled}
                          onSelect={() => onSelectClip(clip.id)}
                          onDragStart={handleDragStart}
                          onDragMove={handleDragMove}
                          onDragEnd={handleDragEnd}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
              {/* 底部拖放区：拖到这创建新轨道（素材库拖入 或 已有片段迁入） */}
              <div
                data-newtrack-zone="1"
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

          {/* 吸附辅助线（吸附到播放头/片段边缘时显示黄色竖线） */}
          {globalDrag && globalDrag.snapLineFrame !== null && (
            <div
              className="pointer-events-none absolute top-0 z-[55] w-0.5 bg-yellow-400"
              style={{
                left: LEFT_W + framesToPx(globalDrag.snapLineFrame, fps, pxPerSecond),
                height: playheadHeight,
              }}
            />
          )}

          {/* 拖拽 ghost：仅跨轨时显示（同轨真实片段实时移动，无需 ghost） */}
          {globalDrag && globalDrag.candidateTrackId !== globalDrag.trackId && (() => {
            const targetId = globalDrag.candidateTrackId ?? globalDrag.trackId;
            // 计算候选轨道行的 top（tracks 渲染是 reverse）。
            let top = RULER_H;
            let laneH = VIDEO_TRACK_H;
            const reversed = [...timeline.tracks].reverse();
            for (const t of reversed) {
              const h = trackHeight(t);
              top += TRACK_GAP;
              if (t.id === targetId) { laneH = h; break; }
              top += h;
            }
            // 跨轨 ghost：真实大小（不缩小），左边缘对齐 ghostStart（已磁吸）。
            const gw = framesToPx(globalDrag.origDuration, fps, pxPerSecond);
            const gx = LEFT_W + framesToPx(globalDrag.ghostStart, fps, pxPerSecond);
            return (
              <div
                className="pointer-events-none absolute z-50 flex items-center gap-1.5 overflow-hidden rounded-md border-2 border-dashed border-accent px-2 opacity-60 shadow-lg"
                style={{
                  left: gx,
                  top,
                  width: Math.max(gw, 20),
                  height: laneH,
                  backgroundColor: globalDrag.color,
                }}
              >
                <span className="truncate text-xs font-medium text-fg">{globalDrag.assetName}</span>
              </div>
            );
          })()}

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
