import { randomUUID } from 'crypto';
import type { Asset, Clip, CreateAiMixInput, TextClip, Timeline, Track } from '@reel/contracts';

function uuid(): string {
  return randomUUID();
}

function defaultTransform(): Clip['transform'] {
  return { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, volume: 1, speed: 1, fadeInDuration: 0, fadeOutDuration: 0 };
}

function textStyle(fontSize: number): TextClip['style'] {
  return {
    fontFamily: 'Arial',
    fontSize,
    color: '#FFFFFF',
    align: 'center',
    bold: true,
    italic: false,
    strokeColor: '#000000',
    strokeWidth: 4,
    backgroundColor: null,
  };
}

function clipDuration(asset: Asset, fallbackFrames: number): number {
  if (asset.durationInFrames && asset.durationInFrames > 0) return asset.durationInFrames;
  return fallbackFrames;
}

function visualSlotFrames(style: CreateAiMixInput['style'], fps: number, index: number): number {
  if (style === 'hook') return Math.round((index < 3 ? 1.4 : 2.4) * fps);
  if (style === 'steady') return Math.round((index < 2 ? 3 : 4) * fps);
  return Math.round((index < 4 ? 1.6 : 2.6) * fps);
}

function defaultHook(style: CreateAiMixInput['style']): string {
  if (style === 'steady') return '这套方案，帮你稳住转化';
  if (style === 'hook') return '别再浪费广告预算';
  return '3 秒看懂核心卖点';
}

function buildTextClips(input: CreateAiMixInput, totalFrames: number, fps: number): TextClip[] {
  const points = input.sellingPoints.length > 0 ? input.sellingPoints : ['提升转化效率', '快速生成广告素材'];
  const hookFrames = Math.min(Math.round(3 * fps), totalFrames);
  const ctaFrames = Math.min(Math.round(3 * fps), totalFrames);
  const middleStart = hookFrames;
  const middleEnd = Math.max(middleStart, totalFrames - ctaFrames);
  const pointFrames = points.length > 0 ? Math.max(fps * 2, Math.floor((middleEnd - middleStart) / points.length)) : 0;

  const middleTexts = points.map((point, index) => ({
    id: uuid(),
    text: point,
    start: Math.min(middleStart + index * pointFrames, Math.max(middleStart, middleEnd - fps * 2)),
    durationInFrames: Math.max(fps * 2, Math.min(pointFrames, middleEnd - middleStart)),
    x: 0,
    y: -330,
    scale: 1,
    rotation: 0,
    opacity: 1,
    style: textStyle(56),
  }));

  return [
    {
      id: uuid(),
      text: defaultHook(input.style),
      start: 0,
      durationInFrames: hookFrames,
      x: 0,
      y: -360,
      scale: 1,
      rotation: 0,
      opacity: 1,
      style: textStyle(68),
    },
    ...middleTexts,
    {
      id: uuid(),
      text: input.cta,
      start: Math.max(totalFrames - ctaFrames, 0),
      durationInFrames: ctaFrames,
      x: 0,
      y: 350,
      scale: 1,
      rotation: 0,
      opacity: 1,
      style: textStyle(60),
    },
  ];
}

function buildVisualClips(assets: Asset[], input: CreateAiMixInput, totalFrames: number, fps: number): Clip[] {
  const visuals = assets.filter((asset) => asset.kind === 'video' || asset.kind === 'image');
  if (visuals.length === 0) return [];

  const clips: Clip[] = [];
  let cursor = 0;
  let index = 0;
  while (cursor < totalFrames) {
    const asset = visuals[index % visuals.length]!;
    const requested = visualSlotFrames(input.style, fps, index);
    const remaining = totalFrames - cursor;
    const duration = Math.max(1, Math.min(requested, remaining, clipDuration(asset, requested)));
    clips.push({
      id: uuid(),
      assetId: asset.id,
      start: cursor,
      durationInFrames: duration,
      trimStart: asset.kind === 'video' && clipDuration(asset, duration) > duration
        ? Math.round(((index * 0.17) % 0.65) * Math.max(0, clipDuration(asset, duration) - duration))
        : 0,
      transform: defaultTransform(),
    });
    cursor += duration;
    index += 1;
  }
  return clips;
}

function buildAudioClips(assets: Asset[], totalFrames: number): Clip[] {
  const audio = assets.find((asset) => asset.kind === 'audio');
  if (!audio) return [];
  return [
    {
      id: uuid(),
      assetId: audio.id,
      start: 0,
      durationInFrames: Math.min(totalFrames, clipDuration(audio, totalFrames)),
      trimStart: 0,
      transform: { ...defaultTransform(), volume: 0.65 },
    },
  ];
}

export function generateAdMixTimeline(
  base: Timeline,
  assets: Asset[],
  input: CreateAiMixInput,
): Timeline {
  const fps = base.settings.fps;
  const totalFrames = input.durationSec * fps;
  const videoClips = buildVisualClips(assets, input, totalFrames, fps);
  const audioClips = buildAudioClips(assets, totalFrames);
  const textClips = buildTextClips(input, totalFrames, fps);

  const tracks: Track[] = [];
  if (videoClips.length > 0) {
    tracks.push({ id: uuid(), kind: 'video', muted: false, hidden: false, clips: videoClips });
  }
  if (audioClips.length > 0) {
    tracks.push({ id: uuid(), kind: 'audio', muted: false, hidden: false, clips: audioClips });
  }
  tracks.push({ id: uuid(), kind: 'text', muted: false, hidden: false, clips: [], textClips });

  return { settings: base.settings, tracks };
}
