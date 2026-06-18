import { useRef } from 'react';
import type { Clip } from '@reel/contracts';
import { useEditorStore } from '../store';

interface TransformBoxProps {
  clip: Clip;
  /** 显示空间像素 / 项目像素 的比例（把 transform.x/y 的项目像素映射到屏幕） */
  displayScale: number;
  /** 内容在 scale=1 时的显示尺寸（已 object-contain 适配舞台） */
  baseWidth: number;
  baseHeight: number;
  /** 内容在 scale=1、x=y=0 时左上角相对舞台的偏移（object-contain 居中留白） */
  baseLeft: number;
  baseTop: number;
}

type DragMode =
  | { kind: 'move'; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'scale'; startDist: number; origScale: number; cx: number; cy: number };

/**
 * 预览里的交互式变换框：拖动改 transform.x/y（项目像素），拖角等比缩放改 transform.scale。
 * 中心锚点缩放。提交走 updateClipTransform（带历史）。
 */
export function TransformBox({
  clip,
  displayScale,
  baseWidth,
  baseHeight,
  baseLeft,
  baseTop,
}: TransformBoxProps) {
  const updateTransform = useEditorStore((s) => s.updateClipTransform);
  const commitHistory = useEditorStore((s) => s.commitHistory);
  const drag = useRef<DragMode | null>(null);
  const snapshot = useRef<ReturnType<typeof useEditorStore.getState>['timeline']>(null);
  const moved = useRef(false);

  const t = clip.transform;
  const scale = t.scale;

  // 变换后内容在舞台上的盒子（显示空间）。中心锚点：缩放围绕内容中心。
  const cx = baseLeft + baseWidth / 2 + t.x * displayScale;
  const cy = baseTop + baseHeight / 2 + t.y * displayScale;
  const w = baseWidth * scale;
  const h = baseHeight * scale;
  const left = cx - w / 2;
  const top = cy - h / 2;

  const begin = () => {
    snapshot.current = useEditorStore.getState().timeline;
    moved.current = false;
  };
  const end = (e: React.PointerEvent) => {
    if (moved.current && snapshot.current) commitHistory(snapshot.current);
    drag.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const onMoveDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    begin();
    drag.current = { kind: 'move', startX: e.clientX, startY: e.clientY, origX: t.x, origY: t.y };
  };

  const onScaleDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    begin();
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const centerX = rect.left + cx;
    const centerY = rect.top + cy;
    const startDist = Math.hypot(e.clientX - centerX, e.clientY - centerY);
    drag.current = { kind: 'scale', startDist, origScale: scale, cx: centerX, cy: centerY };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    moved.current = true;
    if (d.kind === 'move') {
      // 屏幕位移 → 项目像素位移。
      const dx = (e.clientX - d.startX) / displayScale;
      const dy = (e.clientY - d.startY) / displayScale;
      updateTransform(clip.id, { x: Math.round(d.origX + dx), y: Math.round(d.origY + dy) });
    } else {
      const dist = Math.hypot(e.clientX - d.cx, e.clientY - d.cy);
      const next = Math.max(0.1, Math.min(5, (d.origScale * dist) / (d.startDist || 1)));
      updateTransform(clip.id, { scale: Math.round(next * 100) / 100 });
    }
  };

  const handle =
    'absolute h-3 w-3 rounded-sm border border-white bg-accent shadow';

  return (
    <div
      className="absolute z-20 border-2 border-accent"
      style={{ left, top, width: w, height: h, cursor: 'move' }}
      onPointerDown={onMoveDown}
      onPointerMove={onMove}
      onPointerUp={end}
    >
      {/* 四角缩放手柄 */}
      {[
        { c: '-left-1.5 -top-1.5', cursor: 'nwse-resize' },
        { c: '-right-1.5 -top-1.5', cursor: 'nesw-resize' },
        { c: '-left-1.5 -bottom-1.5', cursor: 'nesw-resize' },
        { c: '-right-1.5 -bottom-1.5', cursor: 'nwse-resize' },
      ].map((p, i) => (
        <div
          key={i}
          className={`${handle} ${p.c}`}
          style={{ cursor: p.cursor }}
          onPointerDown={onScaleDown}
          onPointerMove={onMove}
          onPointerUp={end}
        />
      ))}
    </div>
  );
}
