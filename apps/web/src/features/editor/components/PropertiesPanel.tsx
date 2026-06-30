import { useEditorStore } from '../store';
import type { Clip, TextClip } from '@reel/contracts';

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

/** 找到选中的文本片段 */
function useSelectedTextClip(): TextClip | null {
  const timeline = useEditorStore((s) => s.timeline);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  if (!timeline || !selectedClipId) return null;
  for (const track of timeline.tracks) {
    if (track.kind === 'text' && track.textClips) {
      const tc = track.textClips.find((tc) => tc.id === selectedClipId);
      if (tc) return tc;
    }
  }
  return null;
}

/** 文本编辑面板 */
function TextPanel({ textClip }: { textClip: TextClip }) {
  const updateTextClip = useEditorStore((s) => s.updateTextClip);
  const id = textClip.id;
  const s = textClip.style;

  return (
    <div className="flex h-full w-[300px] flex-col border-l border-border-subtle bg-surface">
      <div className="flex h-[46px] items-center border-b border-border-subtle px-3">
        <span className="text-sm font-semibold text-fg">文本</span>
      </div>
      <div className="flex flex-col gap-4 overflow-y-auto p-[18px]">
        {/* 文本内容 */}
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold">内容</h3>
          <textarea
            value={textClip.text}
            onChange={(e) => updateTextClip(id, { text: e.target.value })}
            rows={3}
            className="w-full resize-none rounded-md border border-border-subtle bg-base px-2 py-1.5 text-[13px] text-fg outline-none focus:border-accent"
          />
        </section>

        {/* 字体大小 */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-fg-secondary">字号</span>
            <span className="text-[13px] tabular-nums text-fg-tertiary">{s.fontSize}px</span>
          </div>
          <input
            type="range"
            min={12}
            max={200}
            step={1}
            value={s.fontSize}
            onChange={(e) => updateTextClip(id, { style: { fontSize: Number(e.target.value) } })}
            className="reel-slider h-1 w-full cursor-pointer appearance-none rounded-full bg-timeline-track"
          />
        </section>

        {/* 颜色 + 样式 */}
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold">样式</h3>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[13px] text-fg-secondary">
              颜色
              <input
                type="color"
                value={s.color}
                onChange={(e) => updateTextClip(id, { style: { color: e.target.value } })}
                className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent"
              />
            </label>
            <button
              onClick={() => updateTextClip(id, { style: { bold: !s.bold } })}
              className={`h-7 w-7 rounded font-bold ${s.bold ? 'bg-accent text-white' : 'bg-elevated text-fg-secondary'}`}
            >
              B
            </button>
            <button
              onClick={() => updateTextClip(id, { style: { italic: !s.italic } })}
              className={`h-7 w-7 rounded italic ${s.italic ? 'bg-accent text-white' : 'bg-elevated text-fg-secondary'}`}
            >
              I
            </button>
          </div>
          {/* 对齐 */}
          <div className="flex gap-1.5">
            {(['left', 'center', 'right'] as const).map((a) => (
              <button
                key={a}
                onClick={() => updateTextClip(id, { style: { align: a } })}
                className={`flex-1 rounded px-2 py-1 text-[12px] ${
                  s.align === a ? 'bg-accent text-white' : 'bg-elevated text-fg-secondary'
                }`}
              >
                {a === 'left' ? '左' : a === 'center' ? '中' : '右'}
              </button>
            ))}
          </div>
        </section>

        {/* 描边 */}
        <section className="flex flex-col gap-2">
          <label className="flex items-center justify-between text-[13px] text-fg-secondary">
            描边
            <input
              type="checkbox"
              checked={s.strokeColor !== null}
              onChange={(e) =>
                updateTextClip(id, { style: { strokeColor: e.target.checked ? '#000000' : null } })
              }
            />
          </label>
          {s.strokeColor !== null && (
            <input
              type="color"
              value={s.strokeColor}
              onChange={(e) => updateTextClip(id, { style: { strokeColor: e.target.value } })}
              className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent"
            />
          )}
        </section>

        {/* 不透明度 */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-fg-secondary">不透明度</span>
            <span className="text-[13px] tabular-nums text-fg-tertiary">{Math.round(textClip.opacity * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={textClip.opacity}
            onChange={(e) => updateTextClip(id, { opacity: Number(e.target.value) })}
            className="reel-slider h-1 w-full cursor-pointer appearance-none rounded-full bg-timeline-track"
          />
        </section>
      </div>
    </div>
  );
}

export function PropertiesPanel() {
  const active = useEditorStore((s) => s.propTab);
  const setActive = useEditorStore((s) => s.setPropTab);
  const updateTransform = useEditorStore((s) => s.updateClipTransform);
  const setClipSpeed = useEditorStore((s) => s.setClipSpeed);
  const selected = useSelectedClip();
  const selectedText = useSelectedTextClip();

  // 选中文本片段时显示文本面板
  if (selectedText) {
    return <TextPanel textClip={selectedText} />;
  }

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

  // 音频片段只显示"音频"和"变速"tab，移除"画面"
  const availableTabs = isAudioTrack ? TABS.filter((tab) => tab !== '画面') : TABS;
  // 如果当前 active tab 不在可用列表中，切换到第一个可用 tab
  const effectiveTab = availableTabs.includes(active) ? active : availableTabs[0];

  return (
    <div className="flex h-full w-[300px] flex-col border-l border-border-subtle bg-surface">
      <div className="flex h-[46px] items-center border-b border-border-subtle px-2">
        {availableTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActive(tab)}
            className={`flex h-full items-center px-3.5 text-sm ${
              tab === effectiveTab ? 'font-semibold text-fg' : 'text-fg-secondary'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-[22px] overflow-y-auto p-[18px]">
        {effectiveTab === '画面' && (
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
          </>
        )}

        {effectiveTab === '音频' && (
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
            <SliderRow
              label="淡入"
              value={`${t.fadeInDuration.toFixed(1)}s`}
              current={t.fadeInDuration}
              min={0}
              max={5}
              step={0.1}
              onChange={(v) => updateTransform(cid, { fadeInDuration: v })}
            />
            <SliderRow
              label="淡出"
              value={`${t.fadeOutDuration.toFixed(1)}s`}
              current={t.fadeOutDuration}
              min={0}
              max={5}
              step={0.1}
              onChange={(v) => updateTransform(cid, { fadeOutDuration: v })}
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

        {effectiveTab === '变速' && (
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
