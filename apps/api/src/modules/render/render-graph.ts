import { existsSync } from 'fs';
import type { Asset, Clip, Timeline, Track, TransitionType } from '@reel/contracts';

export type RenderAsset = Asset & {
  localPath: string | null;
  /** 是否包含音频流（由 render processor 探测后填充）。图片无音频，音频必有音频，视频需探测。 */
  hasAudioStream?: boolean;
};

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

function escapeDrawtextValue(value: string): string {
  return value.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function resolveFontFile(bold: boolean): string | null {
  const candidates = bold
    ? [
        'C:/Windows/Fonts/msyhbd.ttc',
        'C:/Windows/Fonts/simhei.ttf',
        '/System/Library/Fonts/PingFang.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',
      ]
    : [
        'C:/Windows/Fonts/msyh.ttc',
        'C:/Windows/Fonts/simhei.ttf',
        'C:/Windows/Fonts/simsun.ttc',
        '/System/Library/Fonts/PingFang.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
      ];
  return candidates.find((file) => existsSync(file)) ?? null;
}

/** 转场类型 → FFmpeg xfade transition 名称（当前 1:1 直映射） */
const XFADE_NAME: Record<TransitionType, string> = {
  fade: 'fade',
  fadeblack: 'fadeblack',
  dissolve: 'dissolve',
  slideleft: 'slideleft',
  wiperight: 'wiperight',
  circleopen: 'circleopen',
};

/**
 * 转场至多占用两侧较短片段的比例，避免转场时长吃满整个片段。
 * 也用于链式转场（一个片段同时是上一转场的入、下一转场的出）时的钳制。
 */
const MAX_TRANSITION_RATIO = 0.45;

interface VisualEntry {
  gi: number; // 全局唯一序号（label 用）
  inputIdx: number;
  clip: Clip;
  asset: RenderAsset;
  /** 起点（秒，存储位置，不做位移） */
  startSec: number;
  /** 时间轴占用时长（秒） */
  durSec: number;
  /** 源消耗时长（秒），用于 trim / 输入 -t */
  sourceDurationSec: number;
  /** 入向转场时长（秒）：来自同轨前一片段的 transitionOut，0=无 */
  inD: number;
  /** 出向转场时长（秒）：本片段 transitionOut，0=无 */
  outD: number;
  /** 出向转场类型 */
  outType: TransitionType | null;
}

interface AudioEntry {
  inputIdx: number;
  clip: Clip;
  startSec: number;
  sourceDurationSec: number;
  trackMuted: boolean;
}

/**
 * 计算某转场的实际时长（秒），钳制到两侧片段允许的范围内：
 * - 不超过设定值
 * - 不超过 A、B 各自时长 × ratio（避免转场吃满整段）
 * 返回 0 表示该转场不生效（片段过短）。
 * 注：无位移模型下转场就地叠加在边界，不消耗时间轴长度，故无需扣除入向转场。
 */
function resolveTransitionDuration(aDurSec: number, bDurSec: number, requested: number): number {
  const cap = Math.min(aDurSec, bDurSec) * MAX_TRANSITION_RATIO;
  return Math.max(0, Math.min(requested, cap));
}

export function buildGraph(timeline: Timeline, assetById: Map<string, RenderAsset>): BuiltGraph {
  const { fps, width: W, height: H } = timeline.settings;
  const inputs: GraphInput[] = [];
  const visualTracks: VisualEntry[][] = [];
  const audios: AudioEntry[] = [];

  let gi = 0;
  let maxEndSec = 0;

  for (const track of timeline.tracks) {
    if (track.kind === 'text') continue;
    // 按 start 排序，保证转场配对正确。
    const clips = [...track.clips].sort((a, b) => a.start - b.start);
    const entries: VisualEntry[] = [];

    for (let ci = 0; ci < clips.length; ci++) {
      const clip = clips[ci]!;
      const asset = assetById.get(clip.assetId);
      if (!asset?.localPath) continue;

      const startSec = clip.start / fps;
      const durSec = clip.durationInFrames / fps;
      const trimStartSec = clip.trimStart / fps;
      const sourceDurationSec =
        asset.kind === 'image' ? durSec : (clip.durationInFrames * clip.transform.speed) / fps;
      const inputIdx = inputs.length;

      // 入向转场时长：由上一 entry 的 outD 决定（上一片段已算好）
      const prev = entries[entries.length - 1];
      const inD = prev ? prev.outD : 0;

      // 出向转场：仅当本片段有 transitionOut，且同轨下一片段存在并相邻。
      let outD = 0;
      let outType: TransitionType | null = null;
      const next = clips[ci + 1];
      const isVideoLike = asset.kind === 'video' || asset.kind === 'image';
      if (
        track.kind === 'video' &&
        isVideoLike &&
        clip.transitionOut &&
        next &&
        next.start === clip.start + clip.durationInFrames
      ) {
        const nextDurSec = next.durationInFrames / fps;
        outD = resolveTransitionDuration(durSec, nextDurSec, clip.transitionOut.duration);
        if (outD > 0) outType = clip.transitionOut.type;
      }

      if (track.kind === 'video' && isVideoLike) {
        if (asset.kind === 'image') {
          inputs.push({ path: asset.localPath, options: ['-loop', '1', '-t', f(durSec)] });
        } else {
          inputs.push({
            path: asset.localPath,
            options: ['-ss', f(trimStartSec), '-t', f(sourceDurationSec), '-ac', '2'],
          });
        }
        entries.push({
          gi: gi++,
          inputIdx,
          clip,
          asset,
          startSec,
          durSec,
          sourceDurationSec,
          inD,
          outD,
          outType,
        });
        if (asset.kind === 'video' && asset.hasAudioStream !== false) {
          // 仅当视频确实含音频流时才加入音频混音（AI 生成的无声视频会被跳过）。
          audios.push({ inputIdx, clip, startSec, sourceDurationSec, trackMuted: track.muted });
        }
      } else if (track.kind === 'audio' && asset.kind === 'audio') {
        inputs.push({
          path: asset.localPath,
          options: ['-ss', f(trimStartSec), '-t', f(sourceDurationSec), '-ac', '2'],
        });
        audios.push({ inputIdx, clip, startSec, sourceDurationSec, trackMuted: track.muted });
      }

      maxEndSec = Math.max(maxEndSec, startSec + durSec);
    }

    if (entries.length > 0) visualTracks.push(entries);
  }

  const durationSec = Math.max(maxEndSec, 0.1);
  if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 86400) {
    throw new Error(`Invalid durationSec: ${durationSec} (maxEndSec=${maxEndSec}, fps=${fps})`);
  }

  const filters: string[] = [];
  filters.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${f(durationSec)}[base]`);
  let last = 'base';
  let overlayCounter = 0;

  /** 构建片段的「局部内容流」（本地 PTS 0..durSec，已缩放/旋转/透明度，未做时间轴位移） */
  const buildContent = (v: VisualEntry): string => {
    const t = v.clip.transform;
    const speed = v.asset.kind === 'video' ? t.speed : 1;
    const label = `vc${v.gi}`;
    const parts: string[] = [];
    parts.push(`trim=duration=${f(v.sourceDurationSec)}`);
    parts.push('setpts=PTS-STARTPTS');
    if (v.asset.kind === 'video' && Math.abs(speed - 1) > 1e-3) {
      parts.push(`setpts=${f(1 / speed)}*PTS`);
    }
    parts.push(`scale=w='min(${W}*${f(t.scale)}\\,iw*${H}*${f(t.scale)}/ih)':h=-1:eval=init`);
    parts.push('format=rgba');
    if (Math.abs(t.rotation) > 1e-3) {
      const rad = f((t.rotation * Math.PI) / 180);
      parts.push(`rotate=${rad}:ow=rotw(${rad}):oh=roth(${rad}):c=none`);
    }
    if (t.opacity < 0.999) {
      parts.push(`colorchannelmixer=aa=${f(t.opacity)}`);
    }
    filters.push(`[${v.inputIdx}:v]${parts.join(',')}[${label}]`);
    return label;
  };

  /** 把局部内容合成到全画幅透明画布（转场需要整帧对整帧混合），返回全画幅流标签（本地 PTS） */
  const buildFullFrame = (v: VisualEntry, contentLabel: string): string => {
    const t = v.clip.transform;
    const baseLabel = `fbase${v.gi}`;
    const outLabel = `full${v.gi}`;
    filters.push(`color=c=black@0:s=${W}x${H}:r=${fps}:d=${f(v.durSec)},format=rgba[${baseLabel}]`);
    const x = `(W-w)/2+${f(t.x)}`;
    const y = `(H-h)/2+${f(t.y)}`;
    filters.push(`[${baseLabel}][${contentLabel}]overlay=x='${x}':y='${y}':eof_action=pass:repeatlast=0[${outLabel}]`);
    return outLabel;
  };

  /** 把某个流按 aSec 做时间轴位移并叠加到累加器，enable 门控在 [aSec,bSec]。positioned=false 表示流已是全画幅（x/y=0）。 */
  const overlayAt = (streamLabel: string, aSec: number, bSec: number, positioned: boolean, x = '', y = '') => {
    const shifted = `sh_${streamLabel}`;
    filters.push(`[${streamLabel}]setpts=PTS+${f(aSec)}/TB[${shifted}]`);
    const out = `ov${overlayCounter++}`;
    const pos = positioned ? `x='${x}':y='${y}':` : '';
    filters.push(
      `[${last}][${shifted}]overlay=${pos}eof_action=pass:repeatlast=0:enable='between(t,${f(aSec)},${f(bSec)})'[${out}]`,
    );
    last = out;
  };

  // 逐轨处理：先叠本体，再把转场段叠在本轨之上；后一轨整体压在前一轨之上。
  // 无位移模型：片段保持存储位置，转场就地叠加在两片段边界，不压缩时间轴。
  for (const entries of visualTracks) {
    // 1) 本体叠加
    for (const v of entries) {
      const t = v.clip.transform;
      const x = `(W-w)/2+${f(t.x)}`;
      const y = `(H-h)/2+${f(t.y)}`;

      // 是否需要全画幅：作为出方（提供尾部）或入方（提供首帧）时才需要。
      const needFull = v.inD > 0 || v.outD > 0;
      if (!needFull) {
        // 无转场：轻量路径（缩放层直接定位叠加，本地 PTS 0）。
        const content = buildContent(v);
        overlayAt(content, v.startSec, v.startSec + v.durSec, true, x, y);
        continue;
      }

      const content = buildContent(v);
      const full = buildFullFrame(v, content);
      // 本体 = 完整内容，仅尾部被出向转场占用（入向转场就地叠在本片段起点之前，不裁本体）。
      const bodyDur = v.durSec - v.outD;
      const needBody = bodyDur > 1e-4;

      const consumers: string[] = [];
      if (needBody) consumers.push(`fb_body${v.gi}`);
      if (v.outD > 0) consumers.push(`fb_tail${v.gi}`);
      if (v.inD > 0) consumers.push(`fb_head${v.gi}`);
      if (consumers.length === 1) {
        filters.push(`[${full}]null[${consumers[0]}]`);
      } else {
        filters.push(`[${full}]split=${consumers.length}${consumers.map((c) => `[${c}]`).join('')}`);
      }

      if (needBody) {
        // 本体从本地 0 起，时长 durSec-outD，定位到片段起点。
        const bodyLabel = `body${v.gi}`;
        filters.push(`[fb_body${v.gi}]trim=duration=${f(bodyDur)},setpts=PTS-STARTPTS[${bodyLabel}]`);
        overlayAt(bodyLabel, v.startSec, v.startSec + bodyDur, false);
      }
      // 尾部 / 首帧（fb_tail / fb_head）留给下方转场段消费。
    }

    // 2) 转场段：A 尾部（真实播放）xfade 进 B 首帧（冻结），叠加到边界前 D 秒。
    //    与预览一致：转场期间 B 显示静止首帧渐入，转场结束后 B 从头正常播放，时间轴不压缩。
    for (let i = 0; i < entries.length; i++) {
      const a = entries[i]!;
      if (a.outD <= 0 || !a.outType) continue;
      const b = entries[i + 1];
      if (!b) continue;
      const D = a.outD;

      const tailA = `tail${a.gi}`;
      const headB = `head${b.gi}`;
      // A 尾部：真实播放的最后 D 秒。
      filters.push(`[fb_tail${a.gi}]trim=start=${f(a.durSec - D)}:duration=${f(D)},setpts=PTS-STARTPTS[${tailA}]`);
      // B 首帧冻结 D 秒（取首帧 → tpad 克隆保持）。
      filters.push(
        `[fb_head${b.gi}]trim=duration=${f(1 / fps)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${f(D)},trim=duration=${f(D)},setpts=PTS-STARTPTS,format=rgba[${headB}]`,
      );

      const seg = `seg${a.gi}`;
      filters.push(
        `[${tailA}][${headB}]xfade=transition=${XFADE_NAME[a.outType]}:duration=${f(D)}:offset=0,format=rgba[${seg}]`,
      );

      // 转场区 = B 起点前 D 秒（= A 终点前 D 秒，两片段相邻）。
      const zoneStart = a.startSec + a.durSec - D;
      overlayAt(seg, zoneStart, zoneStart + D, false);
    }
  }

  let videoOut = last;

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
    const fontFile = resolveFontFile(style.bold);
    const parts: string[] = [
      `text='${escapedText}'`,
      `fontsize=${fontSize}`,
      `fontcolor=${style.color.replace('#', '0x')}@${f(opacity)}`,
      `x='${drawX}'`,
      `y='${drawY}'`,
      `enable='between(t,${f(startSec)},${f(endSec)})'`,
    ];
    if (fontFile) parts.push(`fontfile='${escapeDrawtextValue(fontFile)}'`);
    else if (style.bold) parts.push(`font='Arial Bold'`);
    if (style.strokeColor) {
      parts.push(`borderw=${style.strokeWidth}`);
      parts.push(`bordercolor=${style.strokeColor.replace('#', '0x')}`);
    }
    if (style.backgroundColor) {
      parts.push('box=1');
      parts.push(`boxcolor=${style.backgroundColor.replace('#', '0x')}@1`);
      parts.push('boxborderw=5');
    }
    const out = `vtxt${i}`;
    filters.push(`[${videoOut}]drawtext=${parts.join(':')}[${out}]`);
    videoOut = out;
  });

  if (videoOut !== 'base') {
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
    // 淡入淡出基于「时间轴占用时长」（atempo 后音频流已是该长度），非源时长。
    const clipDurationSec = a.clip.durationInFrames / fps;
    if (t.fadeInDuration > 0) {
      const d = Math.min(t.fadeInDuration, clipDurationSec);
      segs.push(`afade=t=in:st=0:d=${f(d)}`);
    }
    if (t.fadeOutDuration > 0) {
      const d = Math.min(t.fadeOutDuration, clipDurationSec);
      segs.push(`afade=t=out:st=${f(clipDurationSec - d)}:d=${f(d)}`);
    }
    if (t.volume < 0.999) segs.push(`volume=${f(t.volume)}`);
    filters.push(`[${a.inputIdx}:a]${segs.join(',')}[${clipLabel}]`);

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
