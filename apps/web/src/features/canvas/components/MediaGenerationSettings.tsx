import { imageSizesForModel, VIDEO_SIZES } from '@reel/contracts/media-capabilities';
import { Select } from '../../../components/ui/Select';

type Patch = {
  generationSize?: string;
  generationQuality?: 'standard' | 'hd' | 'speed' | 'quality';
  videoFps?: 30 | 60;
  videoWithAudio?: boolean;
};

function sizeAppearance(size: string) {
  const [width = 1, height = 1] = size.split('x').map(Number);
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  return {
    ratio: size === '2048x1080' ? '≈17:9' : `${width / divisor}:${height / divisor}`,
    width: Math.round(24 * Math.min(1, width / height)),
    height: Math.round(24 * Math.min(1, height / width)),
  };
}

export function MediaGenerationSettings({ kind, model, size, quality, fps, withAudio, disabled, onChange }: {
  kind: 'image' | 'video'; model?: string; size: string; quality: NonNullable<Patch['generationQuality']>;
  fps: 30 | 60; withAudio: boolean; disabled: boolean; onChange: (patch: Patch) => void;
}) {
  const video = kind === 'video';
  const sizes = video ? VIDEO_SIZES : imageSizesForModel(model);
  const qualityOptions = video
    ? [{ value: 'speed' as const, label: '速度优先' }, { value: 'quality' as const, label: '质量优先' }]
    : [{ value: 'standard' as const, label: '标准' }, { value: 'hd' as const, label: '高清' }];
  return <Select value={size} options={sizes.map(value => ({ value, label: value.replace('x', ' × ') }))}
    onValueChange={value => onChange({ generationSize: value })}
    triggerContent={video ? `${sizeAppearance(size).ratio} · ${fps} FPS` : sizeAppearance(size).ratio}
    ariaLabel={video ? '选择视频生成设置' : '选择图片生成设置'} disabled={disabled} size="compact"
    menuClassName="!max-h-none !w-[300px] !overflow-visible !rounded-[18px] !p-1.5"
    panel={<div className="space-y-3 p-2.5">
      <section>
        <div className="mb-2 text-xs text-[#9c9ca1]">{video ? '视频分辨率' : '图片尺寸'}</div>
        <div className="grid grid-cols-4 gap-1 rounded-2xl bg-white/[0.06] p-1">
          {sizes.map(value => {
            const appearance = sizeAppearance(value);
            return <button key={value} type="button" disabled={disabled}
              aria-label={value.replace('x', ' × ')}
              aria-pressed={size === value} onClick={() => onChange({ generationSize: value })}
              className={`flex h-[86px] min-w-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-colors ${size === value ? 'bg-white/[0.12] text-white' : 'text-[#77777c] hover:bg-white/[0.06] hover:text-[#c7c7ca]'} disabled:cursor-not-allowed disabled:opacity-45`}>
              <span className="flex h-7 items-center justify-center">
                <span className="rounded-[3px] border-2 border-current" style={{ width: appearance.width, height: appearance.height }} />
              </span>
              <span>{appearance.ratio}</span>
            </button>;
          })}
        </div>
      </section>
      {model === 'Kwai-Kolors/Kolors' && <p className="text-[11px] leading-4 text-[#77777c]">支持 1 张 PNG/JPG/JPEG 参考图，最大 5MB</p>}
      {model !== 'Kwai-Kolors/Kolors' && <section>
        <div className="mb-2 text-xs text-[#9c9ca1]">{video ? '生成模式' : '图片质量'}</div>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/[0.06] p-1">
          {qualityOptions.map(option => <button key={option.value} type="button" disabled={disabled}
            aria-pressed={quality === option.value} onClick={() => onChange({ generationQuality: option.value })}
            className={`h-8 cursor-pointer rounded-lg text-xs ${quality === option.value ? 'bg-white/[0.12] text-white' : 'text-[#99999e] hover:text-white'}`}>
            {option.label}
          </button>)}
        </div>
      </section>}
      {video && <>
        <section>
          <div className="mb-2 text-xs text-[#9c9ca1]">帧率</div>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/[0.06] p-1">
            {([30, 60] as const).map(value => <button key={value} type="button" disabled={disabled}
              aria-pressed={fps === value} onClick={() => onChange({ videoFps: value })}
              className={`h-8 cursor-pointer rounded-lg text-xs ${fps === value ? 'bg-white/[0.12] text-white' : 'text-[#99999e] hover:text-white'}`}>
              {value} FPS
            </button>)}
          </div>
        </section>
        <section>
          <div className="mb-2 text-xs text-[#9c9ca1]">生成音频</div>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/[0.06] p-1">
            {[true, false].map(value => <button key={String(value)} type="button" disabled={disabled}
              aria-pressed={withAudio === value} onClick={() => onChange({ videoWithAudio: value })}
              className={`h-8 cursor-pointer rounded-lg text-xs ${withAudio === value ? 'bg-white/[0.12] text-white' : 'text-[#99999e] hover:text-white'}`}>
              {value ? '开启' : '关闭'}
            </button>)}
          </div>
        </section>
        <p className="text-[11px] leading-4 text-[#77777c]">支持 1 张 PNG/JPG/JPEG 参考图，最大 5MB</p>
      </>}
    </div>} />;
}
