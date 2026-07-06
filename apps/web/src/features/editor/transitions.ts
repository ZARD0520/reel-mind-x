import type { Clip, Timeline, TransitionType } from '@reel/contracts';

/** 转场选项：type ↔ 中文标签，供属性面板下拉使用。 */
export const TRANSITION_OPTIONS: { type: TransitionType; label: string }[] = [
  { type: 'fade', label: '淡入淡出' },
  { type: 'fadeblack', label: '黑场' },
  { type: 'fadewhite', label: '白场' },
  { type: 'dissolve', label: '溶解' },
  { type: 'wipeleft', label: '左擦除' },
  { type: 'wiperight', label: '右擦除' },
  { type: 'wipeup', label: '上擦除' },
  { type: 'wipedown', label: '下擦除' },
  { type: 'slideleft', label: '左滑' },
  { type: 'slideright', label: '右滑' },
  { type: 'slideup', label: '上滑' },
  { type: 'slidedown', label: '下滑' },
  { type: 'circleopen', label: '圆形展开' },
  { type: 'circleclose', label: '圆形收缩' },
  { type: 'smoothleft', label: '平滑左滑' },
  { type: 'smoothright', label: '平滑右滑' },
  { type: 'smoothup', label: '平滑上滑' },
  { type: 'smoothdown', label: '平滑下滑' },
  { type: 'radial', label: '径向擦除' },
  { type: 'distance', label: '距离淡化' },
];

export const TRANSITION_LABEL: Record<TransitionType, string> = Object.fromEntries(
  TRANSITION_OPTIONS.map((o) => [o.type, o.label]),
) as Record<TransitionType, string>;

/** 与后端一致：转场至多占两侧较短片段的比例。 */
export const MAX_TRANSITION_RATIO = 0.45;

/** 在同一轨道里找到紧邻 clip 之后的片段（start === clip 末尾）；无则 null。 */
export function findAdjacentNext(clips: Clip[], clip: Clip): Clip | null {
  const end = clip.start + clip.durationInFrames;
  return clips.find((c) => c.id !== clip.id && c.start === end) ?? null;
}

/**
 * 与后端 resolveTransitionDuration 对齐：把请求的转场时长（秒）钳制到两侧允许范围。
 * 无位移模型下转场就地叠加在边界，不消耗时间轴，故只按两侧较短片段 × ratio 钳制。
 */
export function clampTransitionDuration(aDurSec: number, bDurSec: number, requestedSec: number): number {
  const cap = Math.min(aDurSec, bDurSec) * MAX_TRANSITION_RATIO;
  return Math.max(0, Math.min(requestedSec, cap));
}

/** 预览用的转场实例：定位在时间轴（帧）上的一段 xfade 效果。 */
export interface PlacedTransition {
  /** 前一片段（转场淡出方） */
  from: Clip;
  /** 后一片段（转场淡入方） */
  to: Clip;
  type: TransitionType;
  /** 转场区起始帧（存储位置，不做位移） */
  startFrame: number;
  /** 转场时长（帧） */
  durFrames: number;
}

/**
 * 预览用转场列表：相邻片段钳制配对，定位在**存储时间轴**（无位移），
 * 转场区起点 = A 末尾 - D = B 起点 - D（两片段相邻）。
 */
export function previewTransitions(clips: Clip[], fps: number): PlacedTransition[] {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const out: PlacedTransition[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const clip = sorted[i]!;
    const next = sorted[i + 1];
    if (clip.transitionOut && next && next.start === clip.start + clip.durationInFrames) {
      const aDurSec = clip.durationInFrames / fps;
      const bDurSec = next.durationInFrames / fps;
      const dSec = clampTransitionDuration(aDurSec, bDurSec, clip.transitionOut.duration);
      const outD = Math.round(dSec * fps);
      if (outD > 0) {
        out.push({
          from: clip,
          to: next,
          type: clip.transitionOut.type,
          startFrame: clip.start + clip.durationInFrames - outD,
          durFrames: outD,
        });
      }
    }
  }
  return out;
}

/** 整个时间轴（所有轨道）的总帧数：max(start + duration)，无位移，直接取存储位置。 */
export function effectiveTotalFrames(timeline: Timeline): number {
  let max = 0;
  for (const track of timeline.tracks) {
    if (track.kind === 'video' || track.kind === 'audio') {
      for (const c of track.clips) max = Math.max(max, c.start + c.durationInFrames);
    } else if (track.kind === 'text' && track.textClips) {
      for (const tc of track.textClips) max = Math.max(max, tc.start + tc.durationInFrames);
    }
  }
  return max;
}

/**
 * 预览用的转场样式：给定类型与进度 p∈[0,1]，返回出/入方的 CSS transform/clip-path。
 * 几何类效果用 CSS 近似（与 FFmpeg xfade 算法不完全一致，但足够预览区分）。
 */
export interface TransitionStyle {
  /** 出方（from）的不透明度 */
  fromOpacity: number;
  /** 入方（to）的不透明度 */
  toOpacity: number;
  /** 出方的 CSS transform（可选，叠加在片段自身 transform 之后） */
  fromTransform?: string;
  /** 入方的 CSS transform（可选） */
  toTransform?: string;
  /** 出方的 clip-path（可选） */
  fromClip?: string;
  /** 入方的 clip-path（可选） */
  toClip?: string;
}

export function transitionStyle(type: TransitionType, p: number): TransitionStyle {
  switch (type) {
    case 'fade':
    case 'dissolve':
      // 标准交叉淡化（dissolve 在 FFmpeg 是像素级随机，预览降级为 fade）
      return { fromOpacity: 1 - p, toOpacity: p };

    case 'fadeblack':
      // 经过黑场：前半淡出到黑，后半从黑淡入
      return {
        fromOpacity: Math.max(0, 1 - p * 2),
        toOpacity: Math.max(0, p * 2 - 1),
      };

    case 'fadewhite':
      // 经过白场：前半淡出到白，后半从白淡入
      return {
        fromOpacity: Math.max(0, 1 - p * 2),
        toOpacity: Math.max(0, p * 2 - 1),
      };

    case 'slideleft':
      // 左滑：前片段左移消失，后片段从右侧滑入
      return {
        fromOpacity: 1,
        toOpacity: 1,
        fromTransform: `translateX(${-p * 100}%)`,
        toTransform: `translateX(${(1 - p) * 100}%)`,
      };

    case 'slideright':
      // 右滑：前片段右移消失，后片段从左侧滑入
      return {
        fromOpacity: 1,
        toOpacity: 1,
        fromTransform: `translateX(${p * 100}%)`,
        toTransform: `translateX(${-(1 - p) * 100}%)`,
      };

    case 'slideup':
      // 上滑：前片段上移消失，后片段从下方滑入
      return {
        fromOpacity: 1,
        toOpacity: 1,
        fromTransform: `translateY(${-p * 100}%)`,
        toTransform: `translateY(${(1 - p) * 100}%)`,
      };

    case 'slidedown':
      // 下滑：前片段下移消失，后片段从上方滑入
      return {
        fromOpacity: 1,
        toOpacity: 1,
        fromTransform: `translateY(${p * 100}%)`,
        toTransform: `translateY(${-(1 - p) * 100}%)`,
      };

    case 'wipeleft':
      // 左擦除：后片段从右向左逐渐显现，覆盖前片段
      return {
        fromOpacity: 1,
        toOpacity: 1,
        toClip: `inset(0 0 0 ${(1 - p) * 100}%)`,
      };

    case 'wiperight':
      // 右擦除：后片段从左向右逐渐显现，覆盖前片段
      return {
        fromOpacity: 1,
        toOpacity: 1,
        toClip: `inset(0 ${(1 - p) * 100}% 0 0)`,
      };

    case 'wipeup':
      // 上擦除：后片段从下向上逐渐显现，覆盖前片段
      return {
        fromOpacity: 1,
        toOpacity: 1,
        toClip: `inset(${(1 - p) * 100}% 0 0 0)`,
      };

    case 'wipedown':
      // 下擦除：后片段从上向下逐渐显现，覆盖前片段
      return {
        fromOpacity: 1,
        toOpacity: 1,
        toClip: `inset(0 0 ${(1 - p) * 100}% 0)`,
      };

    case 'circleopen':
      // 圆形展开：后片段从中心圆形展开覆盖前片段
      return {
        fromOpacity: 1,
        toOpacity: 1,
        toClip: `circle(${p * 150}% at center)`,
      };

    case 'circleclose':
      // 圆形收缩：前片段从外向内圆形收缩，露出后片段
      return {
        fromOpacity: 1,
        toOpacity: 1,
        fromClip: `circle(${(1 - p) * 150}% at center)`,
      };

    case 'smoothleft':
      // 平滑左滑：结合淡化的左滑
      return {
        fromOpacity: 1 - p * 0.7,
        toOpacity: p,
        fromTransform: `translateX(${-p * 80}%)`,
        toTransform: `translateX(${(1 - p) * 80}%)`,
      };

    case 'smoothright':
      // 平滑右滑：结合淡化的右滑
      return {
        fromOpacity: 1 - p * 0.7,
        toOpacity: p,
        fromTransform: `translateX(${p * 80}%)`,
        toTransform: `translateX(${-(1 - p) * 80}%)`,
      };

    case 'smoothup':
      // 平滑上滑：结合淡化的上滑
      return {
        fromOpacity: 1 - p * 0.7,
        toOpacity: p,
        fromTransform: `translateY(${-p * 80}%)`,
        toTransform: `translateY(${(1 - p) * 80}%)`,
      };

    case 'smoothdown':
      // 平滑下滑：结合淡化的下滑
      return {
        fromOpacity: 1 - p * 0.7,
        toOpacity: p,
        fromTransform: `translateY(${p * 80}%)`,
        toTransform: `translateY(${-(1 - p) * 80}%)`,
      };

    case 'radial':
      // 径向擦除：近似用径向渐变裁剪（FFmpeg 有径向模糊，CSS 用缩放+淡化近似）
      return {
        fromOpacity: 1 - p,
        toOpacity: p,
        fromTransform: `scale(${1 + p * 0.2})`,
        toTransform: `scale(${1 - (1 - p) * 0.2})`,
      };

    case 'distance':
      // 距离淡化：根据像素亮度距离融合（CSS 无法准确模拟，降级为淡化）
      return { fromOpacity: 1 - p, toOpacity: p };

    default:
      return { fromOpacity: 1 - p, toOpacity: p };
  }
}

