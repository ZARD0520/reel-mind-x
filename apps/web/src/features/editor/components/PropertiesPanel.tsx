import { useEditorStore } from '../store';
import type { Clip } from '@reel/contracts';

type TabKey = '画面' | '音频' | '变速';
const TABS: TabKey[] = ['画面', '音频', '变速'];

interface SliderRowProps {
  label: string;
  value: string;
  /** 滑块当前值 */
  current: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}

function SliderRow({ label, value, current, min, max, step = 0.01, onChange }: SliderRowProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-fg-secondary">{label}</span>
        <span className="text-[13px] tabular-nums text-fg-tertiary">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={(e) => onChange(Number(e.target.value))}
        className="reel-slider h-1 w-full cursor-pointer appearance-none rounded-full bg-timeline-track"
      />
    </div>
  );
}

/** 找到选中片段及其所在轨道类型 */
function useSelectedClip(): { clip: Clip; isAudioTrack: boolean } | null {
  const timeline = useEditorStore((s) => s.timeline);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  if (!timeline || !selectedClipId) return null;
  for (const track of timeline.tracks) {
    const clip = track.clips.find((c) => c.id === selectedClipId);
    if (clip) return { clip, isAudioTrack: track.kind === 'audio' };
  }
  return null;
}

export function PropertiesPanel() {
  const active = useEditorStore((s) => s.propTab);
  const setActive = useEditorStore((s) => s.setPropTab);
  const updateTransform = useEditorStore((s) => s.updateClipTransform);
  const setClipSpeed = useEditorStore((s) => s.setClipSpeed);
  const selected = useSelectedClip();

  const header = (
    <div className="flex h-[46px] items-center border-b border-border-subtle px-2">
      {TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => setActive(tab)}
          className={`flex h-full items-center px-3.5 text-sm ${
            tab === active ? 'font-semibold text-fg' : 'text-fg-secondary'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );

  if (!selected) {
    return (
      <div className="flex h-full w-[300px] flex-col border-l border-border-subtle bg-surface">
        {header}
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-fg-tertiary">
          选中时间轴上的片段以编辑属性
        </div>
      </div>
    );
  }

  const { clip, isAudioTrack } = selected;
  const t = clip.transform;
  const cid = clip.id;

  return (
    <div className="flex h-full w-[300px] flex-col border-l border-border-subtle bg-surface">
      {header}
      <div className="flex flex-col gap-[22px] overflow-y-auto p-[18px]">
        {active === '画面' && (
          <>
            <section className="flex flex-col gap-3.5">
              <h3 className="text-[13px] font-semibold">变换</h3>
              <SliderRow
                label="缩放"
                value={`${Math.round(t.scale * 100)}%`}
                current={t.scale}
                min={0.1}
                max={3}
                onChange={(v) => updateTransform(cid, { scale: v })}
              />
              <SliderRow
                label="不透明度"
                value={`${Math.round(t.opacity * 100)}%`}
                current={t.opacity}
                min={0}
                max={1}
                onChange={(v) => updateTransform(cid, { opacity: v })}
              />
              <SliderRow
                label="旋转"
                value={`${Math.round(t.rotation)}°`}
                current={t.rotation}
                min={-180}
                max={180}
                step={1}
                onChange={(v) => updateTransform(cid, { rotation: v })}
              />
            </section>
            {isAudioTrack && (
              <p className="text-[12px] text-fg-tertiary">音频片段无画面属性。</p>
            )}
          </>
        )}

        {active === '音频' && (
          <section className="flex flex-col gap-3.5">
            <h3 className="text-[13px] font-semibold">音频</h3>
            <SliderRow
              label="音量"
              value={`${Math.round(t.volume * 100)}%`}
              current={t.volume}
              min={0}
              max={1}
              onChange={(v) => updateTransform(cid, { volume: v })}
            />
            <button
              type="button"
              onClick={() => updateTransform(cid, { volume: t.volume === 0 ? 1 : 0 })}
              className="self-start rounded-md bg-elevated px-3 py-1.5 text-[13px] text-fg-secondary hover:text-fg"
            >
              {t.volume === 0 ? '取消静音' : '静音'}
            </button>
          </section>
        )}

        {active === '变速' && (
          <section className="flex flex-col gap-3.5">
            <h3 className="text-[13px] font-semibold">变速</h3>
            <SliderRow
              label="倍速"
              value={`${t.speed.toFixed(2)}x`}
              current={t.speed}
              min={0.25}
              max={4}
              step={0.05}
              onChange={(v) => setClipSpeed(cid, v)}
            />
            <div className="flex gap-1.5">
              {[0.5, 1, 1.5, 2].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setClipSpeed(cid, s)}
                  className={`rounded-md px-2.5 py-1 text-[12px] ${
                    Math.abs(t.speed - s) < 0.001
                      ? 'bg-accent text-fg'
                      : 'bg-elevated text-fg-secondary hover:text-fg'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
            <p className="text-[12px] text-fg-tertiary">
              变速会按源时长调整片段在时间轴上的长度（变慢变长、变快变短）。
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
