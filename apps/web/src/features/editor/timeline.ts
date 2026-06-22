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

/** 单个刻度 */
export interface RulerTick {
  sec: number;
  major: boolean; // 主刻度（带时间标签）/ 次刻度（短线）
}

// 候选刻度间隔（秒）：主刻度间隔。次刻度 = 主刻度 / 5。
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

/**
 * 动态刻度：根据缩放（pxPerSecond）选合适的主刻度间隔，
 * 保证主刻度间距 ≈ 80px 左右，次刻度细分 5 份。覆盖总时长，至少 30s。
 */
export function rulerTicks(timeline: Timeline, pxPerSecond = PX_PER_SECOND): RulerTick[] {
  const totalSec = totalFrames(timeline) / timeline.settings.fps;
  // 选主刻度间隔：让主刻度像素间距 >= 70px。
  const minMajorPx = 70;
  let majorStep = TICK_STEPS[TICK_STEPS.length - 1]!;
  for (const step of TICK_STEPS) {
    if (step * pxPerSecond >= minMajorPx) {
      majorStep = step;
      break;
    }
  }
  // 次刻度：主刻度 5 等分（间距太小则不画次刻度）。
  const minorStep = majorStep / 5;
  const drawMinor = minorStep * pxPerSecond >= 8;
  const step = drawMinor ? minorStep : majorStep;

  const span = Math.max(30, Math.ceil(totalSec / majorStep) * majorStep + majorStep);
  const ticks: RulerTick[] = [];
  for (let t = 0; t <= span + 1e-6; t += step) {
    const sec = Math.round(t * 1000) / 1000;
    ticks.push({ sec, major: Math.abs(sec % majorStep) < 1e-6 });
  }
  return ticks;
}
