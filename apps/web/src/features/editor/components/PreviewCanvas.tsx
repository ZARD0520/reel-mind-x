import { useEffect, useRef, useState } from 'react';
import { Maximize, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { Asset, Clip, Timeline, Track } from '@reel/contracts';
import { useAssets } from '../hooks';
import { useEditorStore } from '../store';
import { TransformBox } from './TransformBox';
import { AudioMixer } from './AudioMixer';
import { VideoLayer } from './VideoLayer';

const STAGE_W = 640;
const STAGE_H = 360;

function formatTimecode(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

interface ActiveLayer {
  clip: Clip;
  asset: Asset;
  track: Track;
}

/**
 * 当前帧命中的所有可见视频/图片片段，按图层顺序（底→顶）返回。
 * tracks 数组开头＝底层、末尾＝顶层，正序遍历即底→顶；靠后的盖在靠前的上面。
 */
function findActiveLayers(
  timeline: Timeline,
  frame: number,
  assetById: Map<string, Asset>,
): ActiveLayer[] {
  const f = Math.floor(frame);
  const layers: ActiveLayer[] = [];
  for (const track of timeline.tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    for (const clip of track.clips) {
      if (f >= clip.start && f < clip.start + clip.durationInFrames) {
        const asset = assetById.get(clip.assetId);
        if (asset?.status === 'ready' && asset.url) layers.push({ clip, asset, track });
      }
    }
  }
  return layers;
}

interface PreviewCanvasProps {
  currentFrame: number;
  totalFrames: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (frame: number) => void;
}

export function PreviewCanvas({
  currentFrame,
  totalFrames,
  isPlaying,
  onTogglePlay,
  onSeek,
}: PreviewCanvasProps) {
  const timeline = useEditorStore((s) => s.timeline);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const { data: assets = [] } = useAssets();
  const stageRef = useRef<HTMLDivElement>(null);

  const fps = timeline?.settings.fps ?? 30;
  const projectW = timeline?.settings.width ?? 1920;
  const projectH = timeline?.settings.height ?? 1080;
  const assetById = new Map(assets.map((a) => [a.id, a]));
  // 当前帧所有可见层（底→顶）。
  const layers = timeline ? findActiveLayers(timeline, currentFrame, assetById) : [];
  const hasVisual = layers.length > 0;

  // 内容（object-contain）在 scale=1 时的显示尺寸与居中留白偏移。
  const contentScale = Math.min(STAGE_W / projectW, STAGE_H / projectH);
  const baseWidth = projectW * contentScale;
  const baseHeight = projectH * contentScale;
  const baseLeft = (STAGE_W - baseWidth) / 2;
  const baseTop = (STAGE_H - baseHeight) / 2;
  // transform.x/y 是项目像素，映射到舞台显示空间的比例。
  const displayScale = contentScale;

  // 选中片段若在当前可见层里，显示交互变换框（非全屏）。
  const selectedLayer = layers.find((l) => l.clip.id === selectedClipId);

  /** 单层的 CSS transform（缩放 + 位移，围绕内容中心）。 */
  const layerTransform = (clip: Clip): string =>
    `translate(${clip.transform.x * displayScale}px, ${clip.transform.y * displayScale}px) scale(${clip.transform.scale})`;

  const timecode = formatTimecode(currentFrame / fps);
  const totalTimecode = formatTimecode(totalFrames / fps);

  // 跟踪全屏状态：全屏时单击画面切换播放/暂停。
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen();
  };

  return (
    <div className="flex h-full flex-1 flex-col bg-base">
      {/* 音频混音：播放所有命中的音频片段（隐藏元素） */}
      {timeline && (
        <AudioMixer
          timeline={timeline}
          assetById={assetById}
          currentFrame={currentFrame}
          isPlaying={isPlaying}
        />
      )}
      <div className="flex flex-1 items-center justify-center p-8">
        <div
          ref={stageRef}
          onClick={() => isFullscreen && onTogglePlay()}
          className={`relative overflow-hidden rounded-lg border border-border-subtle bg-black ${
            isFullscreen ? 'flex h-full w-full cursor-pointer items-center justify-center' : ''
          }`}
          style={isFullscreen ? undefined : { width: 640, height: 360 }}
        >
          {/* 多层叠加：按图层顺序（底→顶）渲染每个命中片段，各自 transform */}
          {layers.map(({ clip, asset, track }, i) =>
            asset.kind === 'image' ? (
              <img
                key={clip.id}
                src={asset.url!}
                alt={asset.name}
                className="absolute inset-0 h-full w-full object-contain"
                style={{ transform: layerTransform(clip), transformOrigin: 'center', zIndex: i }}
              />
            ) : (
              <div key={clip.id} className="absolute inset-0" style={{ zIndex: i }}>
                <VideoLayer
                  clip={clip}
                  asset={asset}
                  muted={track.muted || clip.transform.volume === 0}
                  fps={fps}
                  currentFrame={currentFrame}
                  isPlaying={isPlaying}
                  transform={layerTransform(clip)}
                />
              </div>
            ),
          )}
          {/* 交互式变换框（选中片段在可见层里、非全屏时） */}
          {selectedLayer && !isFullscreen && (
            <TransformBox
              clip={selectedLayer.clip}
              displayScale={displayScale}
              baseWidth={baseWidth}
              baseHeight={baseHeight}
              baseLeft={baseLeft}
              baseTop={baseTop}
            />
          )}
          {/* 无可见片段 / 纯音频 → 占位 */}
          {!hasVisual && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-fg-tertiary">
              <span className="font-mono text-5xl font-bold text-input">{timecode}</span>
              <span className="text-[13px]">{timeline?.tracks.length ? '无视频片段' : '从左侧添加素材'}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex h-13 items-center justify-between border-t border-border-subtle bg-surface px-5 py-3">
        <span className="text-[13px] text-fg-secondary">{timecode}</span>
        <div className="flex items-center gap-[18px]">
          <button
            type="button"
            onClick={() => onSeek(0)}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-fg-secondary hover:bg-elevated"
          >
            <SkipBack className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-elevated text-fg hover:bg-input"
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={() => onSeek(totalFrames)}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-fg-secondary hover:bg-elevated"
          >
            <SkipForward className="h-[18px] w-[18px]" />
          </button>
        </div>
        <div className="flex items-center gap-3.5">
          <span className="text-[13px] text-fg-tertiary">{totalTimecode}</span>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="text-fg-secondary hover:text-fg"
          >
            <Maximize className="h-[17px] w-[17px]" />
          </button>
        </div>
      </div>
    </div>
  );
}
