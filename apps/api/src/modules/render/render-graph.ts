import type { Asset, Clip, Timeline, Track } from '@reel/contracts';

export type RenderAsset = Asset & { localPath: string | null };

export interface GraphInput {
  path: string;
  options: string[];
}

export interface BuiltGraph {
  inputs: GraphInput[];
  complexFilter: string[];
  maps: string[];
  hasAudio: boolean;
  durationSec: number;
}

function atempoChain(speed: number): number[] {
  if (Math.abs(speed - 1) < 1e-3) return [];
  let value = speed;
  const parts: number[] = [];
  while (value > 2) {
    parts.push(2);
    value /= 2;
  }
  while (value < 0.5) {
    parts.push(0.5);
    value *= 2;
  }
  parts.push(Number(value.toFixed(4)));
  return parts;
}

function f(n: number): string {
  return Number(n.toFixed(4)).toString();
}

function silence(label: string, durationSec: number): string {
  return `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${f(durationSec)},asetpts=PTS-STARTPTS[${label}]`;
}

interface VisualEntry {
  inputIdx: number;
  clip: Clip;
  asset: RenderAsset;
  startSec: number;
  endSec: number;
  sourceDurationSec: number;
}

interface AudioEntry {
  inputIdx: number;
  clip: Clip;
  startSec: number;
  sourceDurationSec: number;
  trackMuted: boolean;
}

export function buildGraph(timeline: Timeline, assetById: Map<string, RenderAsset>): BuiltGraph {
  const { fps, width: W, height: H } = timeline.settings;
  const inputs: GraphInput[] = [];
  const visuals: VisualEntry[] = [];
  const audios: AudioEntry[] = [];

  let totalFrames = 0;
  const collect = (track: Track) => {
    for (const clip of track.clips) {
      const asset = assetById.get(clip.assetId);
      if (!asset?.localPath) continue;

      totalFrames = Math.max(totalFrames, clip.start + clip.durationInFrames);

      const startSec = clip.start / fps;
      const endSec = (clip.start + clip.durationInFrames) / fps;
      const trimStartSec = clip.trimStart / fps;
      const sourceDurationSec =
        asset.kind === 'image' ? endSec - startSec : (clip.durationInFrames * clip.transform.speed) / fps;
      const inputIdx = inputs.length;

      if (track.kind === 'video' && (asset.kind === 'video' || asset.kind === 'image')) {
        if (asset.kind === 'image') {
          inputs.push({ path: asset.localPath, options: ['-loop', '1', '-t', f(endSec - startSec)] });
        } else {
          inputs.push({
            path: asset.localPath,
            options: ['-ss', f(trimStartSec), '-t', f(sourceDurationSec), '-ac', '2'],
          });
        }
        visuals.push({ inputIdx, clip, asset, startSec, endSec, sourceDurationSec });
        if (asset.kind === 'video') {
          audios.push({ inputIdx, clip, startSec, sourceDurationSec, trackMuted: track.muted });
        }
      } else if (track.kind === 'audio' && asset.kind === 'audio') {
        inputs.push({
          path: asset.localPath,
          options: ['-ss', f(trimStartSec), '-t', f(sourceDurationSec), '-ac', '2'],
        });
        audios.push({ inputIdx, clip, startSec, sourceDurationSec, trackMuted: track.muted });
      }
    }
  };

  for (const track of timeline.tracks) collect(track);

  const durationSec = Math.max(totalFrames / fps, 0.1);
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 86400) {
    throw new Error(`Invalid durationSec: ${durationSec} (totalFrames=${totalFrames}, fps=${fps})`);
  }

  const filters: string[] = [];
  filters.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${f(durationSec)}[base]`);

  let last = 'base';
  visuals.forEach((v, i) => {
    const t = v.clip.transform;
    const speed = v.asset.kind === 'video' ? t.speed : 1;
    const vlabel = `v${i}`;
    const parts: string[] = [];

    parts.push(`trim=duration=${f(v.sourceDurationSec)}`);
    parts.push('setpts=PTS-STARTPTS');
    if (v.asset.kind === 'video' && Math.abs(speed - 1) > 1e-3) {
      parts.push(`setpts=${f(1 / speed)}*PTS`);
    }
    parts.push(`setpts=PTS+${f(v.startSec)}/TB`);
    parts.push(`scale=w='min(${W}*${f(t.scale)}\\,iw*${H}*${f(t.scale)}/ih)':h=-1:eval=init`);
    parts.push('format=rgba');
    if (Math.abs(t.rotation) > 1e-3) {
      const rad = f((t.rotation * Math.PI) / 180);
      parts.push(`rotate=${rad}:ow=rotw(${rad}):oh=roth(${rad}):c=none`);
    }
    if (t.opacity < 0.999) {
      parts.push(`colorchannelmixer=aa=${f(t.opacity)}`);
    }
    filters.push(`[${v.inputIdx}:v]${parts.join(',')}[${vlabel}]`);

    const x = `(W-w)/2+${f(t.x)}`;
    const y = `(H-h)/2+${f(t.y)}`;
    const out = i === visuals.length - 1 ? 'vout' : `ov${i}`;
    filters.push(
      `[${last}][${vlabel}]overlay=x='${x}':y='${y}':eof_action=pass:repeatlast=0:enable='between(t,${f(v.startSec)},${f(v.endSec)})'[${out}]`,
    );
    last = out;
  });

  let videoOut = visuals.length > 0 ? 'vout' : 'base';

  const textClips = timeline.tracks
    .filter((t) => t.kind === 'text')
    .flatMap((t) => t.textClips ?? []);

  textClips.forEach((tc, i) => {
    const { text, start, durationInFrames, x, y, scale, opacity, style } = tc;
    const startSec = start / fps;
    const endSec = (start + durationInFrames) / fps;
    const fontSize = Math.round(style.fontSize * scale);
    const drawX = `(w-text_w)/2+${f(x)}`;
    const drawY = `(h-text_h)/2+${f(y)}`;
    const escapedText = text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
    const parts: string[] = [
      `text='${escapedText}'`,
      `fontsize=${fontSize}`,
      `fontcolor=${style.color.replace('#', '0x')}@${f(opacity)}`,
      `x='${drawX}'`,
      `y='${drawY}'`,
      `enable='between(t,${f(startSec)},${f(endSec)})'`,
    ];
    if (style.bold) parts.push(`font='Arial Bold'`);
    if (style.strokeColor) {
      parts.push(`borderw=${style.strokeWidth}`);
      parts.push(`bordercolor=${style.strokeColor.replace('#', '0x')}`);
    }
    if (style.backgroundColor) {
      parts.push('box=1');
      parts.push(`boxcolor=${style.backgroundColor.replace('#', '0x')}@1`);
      parts.push('boxborderw=5');
    }
    const out = i === textClips.length - 1 ? 'vfinal' : `txt${i}`;
    filters.push(`[${videoOut}]drawtext=${parts.join(':')}[${out}]`);
    videoOut = out;
  });

  if (visuals.length > 0 || textClips.length > 0) {
    const trimLabel = 'vtrimmed';
    filters.push(`[${videoOut}]trim=duration=${f(durationSec)},setpts=PTS-STARTPTS[${trimLabel}]`);
    videoOut = trimLabel;
  }

  const aLabels: string[] = [];
  audios.forEach((a, i) => {
    const t = a.clip.transform;
    if (t.volume <= 0 || a.trackMuted) return;
    const clipLabel = `aclip${i}`;
    const outLabel = `a${i}`;
    const segs: string[] = [];
    segs.push('aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo');
    segs.push(`atrim=duration=${f(a.sourceDurationSec)}`);
    segs.push('asetpts=PTS-STARTPTS');
    for (const tp of atempoChain(t.speed)) segs.push(`atempo=${f(tp)}`);
    if (t.volume < 0.999) segs.push(`volume=${f(t.volume)}`);
    filters.push(`[${a.inputIdx}:a]${segs.join(',')}[${clipLabel}]`);

    const clipDurationSec = a.clip.durationInFrames / fps;
    const tailDurationSec = Math.max(durationSec - a.startSec - clipDurationSec, 0);
    const concatInputs: string[] = [];
    if (a.startSec > 0) {
      const preLabel = `asilencepre${i}`;
      filters.push(silence(preLabel, a.startSec));
      concatInputs.push(`[${preLabel}]`);
    }
    concatInputs.push(`[${clipLabel}]`);
    if (tailDurationSec > 0) {
      const tailLabel = `asilencetail${i}`;
      filters.push(silence(tailLabel, tailDurationSec));
      concatInputs.push(`[${tailLabel}]`);
    }
    filters.push(`${concatInputs.join('')}concat=n=${concatInputs.length}:v=0:a=1[${outLabel}]`);
    aLabels.push(outLabel);
  });

  const maps: string[] = [`[${videoOut}]`];
  let hasAudio = false;
  if (aLabels.length === 1) {
    filters.push(`[${aLabels[0]}]atrim=duration=${f(durationSec)},asetpts=PTS-STARTPTS[aout]`);
    maps.push('[aout]');
    hasAudio = true;
  } else if (aLabels.length > 1) {
    const n = aLabels.length;
    filters.push(`${aLabels.map((l) => `[${l}]`).join('')}amix=inputs=${n}:duration=longest[amixraw]`);
    filters.push(`[amixraw]volume=${n},atrim=duration=${f(durationSec)},asetpts=PTS-STARTPTS[aout]`);
    maps.push('[aout]');
    hasAudio = true;
  }

  return { inputs, complexFilter: filters, maps, hasAudio, durationSec };
}
