import type { Clip, Timeline, Track } from '@reel/contracts';
import type { Asset } from '@reel/contracts';

/** 渲染用素材：在对外 Asset 上补 localPath（本机文件路径，worker 喂 FFmpeg）。 */
export type RenderAsset = Asset & { localPath: string | null };

/** 一个 FFmpeg 输入（对应一个 clip 引用的素材文件） */
export interface GraphInput {
  path: string;
  /** 图片需 -loop/-t；视频不需要 */
  options: string[];
}

export interface BuiltGraph {
  inputs: GraphInput[];
  complexFilter: string[];
  /** 输出映射的 video/audio 标签 */
  maps: string[];
  hasAudio: boolean;
  durationSec: number;
}

/** 变速时 atempo 仅支持 [0.5,2]，超范围拆成链式相乘。speed=1 返回空。 */
function atempoChain(speed: number): number[] {
  if (Math.abs(speed - 1) < 1e-3) return [];
  let s = speed;
  const parts: number[] = [];
  while (s > 2) {
    parts.push(2);
    s /= 2;
  }
  while (s < 0.5) {
    parts.push(0.5);
    s *= 2;
  }
  parts.push(Number(s.toFixed(4)));
  return parts;
}

/** 浮点保留 4 位，避免滤镜字符串过长/精度噪声。 */
function f(n: number): string {
  return Number(n.toFixed(4)).toString();
}

interface VisualEntry {
  inputIdx: number;
  clip: Clip;
  asset: RenderAsset;
  startSec: number;
  endSec: number;
}
interface AudioEntry {
  inputIdx: number;
  clip: Clip;
  startSec: number;
  trackMuted: boolean;
}

/**
 * 由 timeline 构建 FFmpeg 输入与 filter_complex。
 * 语义对齐前端预览：
 * - 视频/图片层按轨道顺序（数组开头=底层）叠加，各自 scale/位移/旋转/不透明度。
 * - 片段 start/duration 决定在成片时间轴的出现窗口；trimStart 决定取源起点；speed 变速。
 * - 多音频轨 + 视频自带音轨混音；音量/静音。
 * 注意：hidden 只影响预览，导出仍包含（与 schema 注释一致）。
 */
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
      const idx = inputs.length;

      if (track.kind === 'video' && (asset.kind === 'video' || asset.kind === 'image')) {
        if (asset.kind === 'image') {
          inputs.push({ path: asset.localPath, options: ['-loop', '1', '-t', f(endSec - startSec)] });
        } else {
          inputs.push({ path: asset.localPath, options: ['-ss', f(trimStartSec)] });
        }
        visuals.push({ inputIdx: idx, clip, asset, startSec, endSec });
        // 视频自带音轨也参与混音。
        if (asset.kind === 'video') {
          audios.push({ inputIdx: idx, clip, startSec, trackMuted: track.muted });
        }
      } else if (track.kind === 'audio' && asset.kind === 'audio') {
        inputs.push({ path: asset.localPath, options: ['-ss', f(trimStartSec)] });
        audios.push({ inputIdx: idx, clip, startSec, trackMuted: track.muted });
      }
    }
  };
  // 数组开头=底层，正序遍历即底→顶。
  for (const track of timeline.tracks) collect(track);

  const durationSec = Math.max(totalFrames / fps, 0.1);
  const filters: string[] = [];

  // 黑底基底。
  filters.push(`color=c=black:s=${W}x${H}:r=${fps}:d=${f(durationSec)}[base]`);

  // 逐层视频/图片：scale(contain×transform.scale) → rotate → opacity → overlay。
  let last = 'base';
  visuals.forEach((v, i) => {
    const t = v.clip.transform;
    const speed = asset_isVideo(v.asset) ? t.speed : 1;
    const vlabel = `v${i}`;
    const chain: string[] = [];
    chain.push(`[${v.inputIdx}:v]`);
    const parts: string[] = [];
    // 变速（仅视频，setpts）。
    if (asset_isVideo(v.asset) && Math.abs(speed - 1) > 1e-3) {
      parts.push(`setpts=${f(1 / speed)}*PTS`);
    }
    // contain 适配到画布，再乘 transform.scale（保持等比，超出由 overlay 裁剪）。
    parts.push(
      `scale=w='min(${W}*${f(t.scale)}\\,iw*${H}*${f(t.scale)}/ih)':h=-1:eval=init`,
    );
    parts.push(`format=rgba`);
    if (Math.abs(t.rotation) > 1e-3) {
      const rad = `${f((t.rotation * Math.PI) / 180)}`;
      parts.push(`rotate=${rad}:ow=rotw(${rad}):oh=roth(${rad}):c=none`);
    }
    if (t.opacity < 0.999) {
      parts.push(`colorchannelmixer=aa=${f(t.opacity)}`);
    }
    chain.push(parts.join(','));
    chain.push(`[${vlabel}]`);
    filters.push(chain.join(''));

    // overlay：居中 + 位移；按片段时间窗口 enable。
    const x = `(W-w)/2+${f(t.x)}`;
    const y = `(H-h)/2+${f(t.y)}`;
    const out = i === visuals.length - 1 ? 'vout' : `ov${i}`;
    filters.push(
      `[${last}][${vlabel}]overlay=x='${x}':y='${y}':enable='between(t,${f(v.startSec)},${f(v.endSec)})'[${out}]`,
    );
    last = out;
  });
  const videoOut = visuals.length > 0 ? 'vout' : 'base';

  // 音频：atrim→变速(atempo)→volume→adelay 到 start，再 amix。
  const aLabels: string[] = [];
  audios.forEach((a, i) => {
    const t = a.clip.transform;
    if (t.volume <= 0 || a.trackMuted) return; // 静音不参与混音
    const label = `a${i}`;
    const segs: string[] = [];
    // 取与片段等长的源（timeline 占用 × speed = 源消耗秒数）。
    segs.push(`atrim=duration=${f((a.clip.durationInFrames * t.speed) / fps)}`);
    segs.push('asetpts=PTS-STARTPTS');
    for (const tp of atempoChain(t.speed)) segs.push(`atempo=${f(tp)}`);
    if (t.volume < 0.999) segs.push(`volume=${f(t.volume)}`);
    const delayMs = Math.round(a.startSec * 1000);
    if (delayMs > 0) segs.push(`adelay=${delayMs}|${delayMs}`);
    filters.push(`[${a.inputIdx}:a]${segs.join(',')}[${label}]`);
    aLabels.push(label);
  });

  const maps: string[] = [`[${videoOut}]`];
  let hasAudio = false;
  if (aLabels.length === 1) {
    maps.push(`[${aLabels[0]}]`);
    hasAudio = true;
  } else if (aLabels.length > 1) {
    // amix 会按输入数平均音量；老版 ffmpeg 无 normalize 选项，故 amix 后乘回输入数补偿。
    const n = aLabels.length;
    filters.push(
      `${aLabels.map((l) => `[${l}]`).join('')}amix=inputs=${n}:duration=longest[amixraw]`,
    );
    filters.push(`[amixraw]volume=${n}[aout]`);
    maps.push('[aout]');
    hasAudio = true;
  }

  return { inputs, complexFilter: filters, maps, hasAudio, durationSec };
}

function asset_isVideo(a: RenderAsset): boolean {
  return a.kind === 'video';
}

