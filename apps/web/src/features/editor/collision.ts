import type { Clip } from '@reel/contracts';

type TimelineSegment = Pick<Clip, 'id' | 'start' | 'durationInFrames'>;

// 片段最小帧数（与 Timeline 一致）。
export const MIN_FRAMES = 15;

/** 同轨除自己外的其他片段 */
export function others<T extends TimelineSegment>(clips: T[], selfId: string): T[] {
  return clips.filter((c) => c.id !== selfId);
}

/**
 * 移动碰撞解析：在不与其他片段重叠的前提下，返回最接近 proposedStart 的合法起点。
 * 优先选择 proposedStart 落在其中的空闲区间（支持往前插），其次按距离选最近的。
 * 效果＝拖到空隙里会落在那个空隙；拖到别的素材身上时，吸附到最近空隙的边缘。
 */
export function resolveMove(proposedStart: number, duration: number, neighbors: TimelineSegment[]): number {
  const ps = Math.max(0, proposedStart);
  const occ = neighbors
    .map((c) => [c.start, c.start + c.durationInFrames] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  // 构造空闲区间（含末尾到 Infinity）。
  const free: [number, number][] = [];
  let cursor = 0;
  for (const [os, oe] of occ) {
    if (os > cursor) free.push([cursor, os]);
    cursor = Math.max(cursor, oe);
  }
  free.push([cursor, Infinity]);

  // 优先选择 proposedStart 落在其中的空闲区间。
  for (const [fs, fe] of free) {
    if (fe - fs < duration) continue; // 容不下
    const clamped = Math.max(fs, Math.min(ps, fe - duration));
    if (ps >= fs && ps <= fe - duration) {
      return Math.max(0, clamped); // proposedStart 在此区间内，直接用
    }
  }

  // 否则按距离选最近的空闲区间。
  let best = ps;
  let bestDist = Infinity;
  for (const [fs, fe] of free) {
    if (fe - fs < duration) continue;
    const clamped = Math.max(fs, Math.min(ps, fe - duration));
    const dist = Math.abs(clamped - ps);
    if (dist < bestDist) {
      bestDist = dist;
      best = clamped;
    }
  }
  return Math.max(0, best);
}

/** 紧邻右侧片段的起点（无则 Infinity）——trim 右边缘不得越过 */
export function nextClipStart(clip: Clip, neighbors: Clip[]): number {
  return neighbors
    .filter((c) => c.start > clip.start)
    .reduce((min, c) => Math.min(min, c.start), Infinity);
}

/** 紧邻左侧片段的终点（无则 0）——trim 左边缘 / 左移不得越过 */
export function prevClipEnd(clip: Clip, neighbors: Clip[]): number {
  return neighbors
    .filter((c) => c.start < clip.start)
    .reduce((max, c) => Math.max(max, c.start + c.durationInFrames), 0);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

/** trim 右边缘：给定原始时长 + 位移帧，返回合法新时长（受源时长与右邻居约束） */
export function resolveTrimRight(
  clip: Clip,
  neighbors: Clip[],
  origDuration: number,
  deltaFrames: number,
  sourceMaxDuration: number,
): number {
  const next = nextClipStart(clip, neighbors);
  const neighborMax = next === Infinity ? Infinity : next - clip.start;
  const maxDur = Math.min(sourceMaxDuration, neighborMax);
  return clamp(origDuration + deltaFrames, MIN_FRAMES, maxDur);
}

/**
 * trim 左边缘：返回应用后的 { start, trimStart, durationInFrames }。
 * delta>0 右移（缩短），delta<0 左移（拉长，受源 trimStart、左邻居、最小时长约束）。
 */
export function resolveTrimLeft(
  clip: Clip,
  neighbors: Clip[],
  orig: { start: number; trimStart: number; durationInFrames: number },
  deltaFrames: number,
): { start: number; trimStart: number; durationInFrames: number } {
  const minDelta = Math.max(
    -orig.trimStart, // trimStart 不能为负
    prevClipEnd(clip, neighbors) - orig.start, // 不越过左邻居
    -orig.start, // start 不为负
  );
  const maxDelta = orig.durationInFrames - MIN_FRAMES; // 保留最小时长
  const delta = clamp(deltaFrames, minDelta, maxDelta);
  return {
    start: orig.start + delta,
    trimStart: orig.trimStart + delta,
    durationInFrames: orig.durationInFrames - delta,
  };
}
