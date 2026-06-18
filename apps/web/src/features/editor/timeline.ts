import type { Timeline } from '@reel/contracts';

// 时间轴布局常量。
export const PX_PER_SECOND = 24; // 100% 缩放：每 5s 一个刻度 = 120px
export const TRACK_PAD_LEFT = 16;

// 离散缩放档位（百分比，必含 100%）。放大/缩小在档位间切换，保证能精确停在 100%。
export const ZOOM_LEVELS = [25, 50, 75, 100, 150, 200, 300, 400, 500] as const;
export const DEFAULT_ZOOM = 100;

/** 百分比缩放 → 每秒像素 */
export function zoomToPxPerSecond(zoomPct: number): number {
  return (PX_PER_SECOND * zoomPct) / 100;
}

/** 在档位数组中取下一档（dir=+1 放大 / -1 缩小） */
export function nextZoom(current: number, dir: 1 | -1): number {
  const idx = ZOOM_LEVELS.indexOf(current as (typeof ZOOM_LEVELS)[number]);
  if (idx === -1) {
    // 当前值不在档位上：找最接近的再移动一档。
    const nearest = ZOOM_LEVELS.reduce((a, b) =>
      Math.abs(b - current) < Math.abs(a - current) ? b : a,
    );
    return nextZoom(nearest, dir);
  }
  const next = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, idx + dir));
  return ZOOM_LEVELS[next]!;
}

/** 帧 → 像素（依项目 fps 与当前缩放） */
export function framesToPx(frames: number, fps: number, pxPerSecond = PX_PER_SECOND): number {
  return (frames / fps) * pxPerSecond;
}

/** 像素 → 帧（依项目 fps 与当前缩放） */
export function pxToFrames(px: number, fps: number, pxPerSecond = PX_PER_SECOND): number {
  return Math.round((px / pxPerSecond) * fps);
}

/** 时间轴总时长（帧）：所有片段结束位置的最大值 */
export function totalFrames(timeline: Timeline): number {
  let max = 0;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      max = Math.max(max, clip.start + clip.durationInFrames);
    }
  }
  return max;
}

/** 刻度（秒）：覆盖总时长，至少 45s，按 5s 一档 */
export function rulerTicks(timeline: Timeline): number[] {
  const totalSec = totalFrames(timeline) / timeline.settings.fps;
  const span = Math.max(45, Math.ceil(totalSec / 5) * 5 + 5);
  return Array.from({ length: span / 5 + 1 }, (_, i) => i * 5);
}
