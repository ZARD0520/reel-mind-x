import { useRef, useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useEditorStore } from '../store';
import type { Clip, TextClip, TransitionType } from '@reel/contracts';
import { TRANSITION_OPTIONS, findAdjacentNext } from '../transitions';

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

interface TransitionSelectProps {
  value: TransitionType | null;
  onChange: (type: TransitionType | null) => void;
}

function TransitionSelect({ value, onChange }: TransitionSelectProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentLabel = value ? TRANSITION_OPTIONS.find((o) => o.type === value)?.label ?? '未知' : '无转场（硬切）';

  const toggle = () => {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    }
    setOpen(!open);
  };

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        menuRef.current &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    // 面板/页面滚动时跟随按钮重新定位（下拉列表自身滚动不受影响）。
    const reposition = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      if (buttonRef.current) {
        const r = buttonRef.current.getBoundingClientRect();
        setRect({ left: r.left, top: r.bottom + 4, width: r.width });
      }
    };
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between rounded-md border border-border-subtle bg-base px-3 py-1.5 text-[13px] text-fg outline-none hover:border-accent"
      >
        <span>{currentLabel}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && rect && (
        <div
          ref={menuRef}
          className="fixed z-50 rounded-md border border-border-subtle bg-elevated shadow-lg"
          style={{ left: rect.left, top: rect.top, width: rect.width }}
        >
          <div className="reel-scroll max-h-48 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className={`w-full px-3 py-1.5 text-left text-[13px] transition-colors ${
                value === null ? 'bg-accent-soft text-fg' : 'text-fg-secondary hover:bg-surface hover:text-fg'
              }`}
            >
              无转场（硬切）
            </button>
            {TRANSITION_OPTIONS.map((opt) => (
              <button
                key={opt.type}
                type="button"
                onClick={() => {
                  onChange(opt.type);
                  setOpen(false);
                }}
                className={`w-full px-3 py-1.5 text-left text-[13px] transition-colors ${
                  value === opt.type ? 'bg-accent-soft text-fg' : 'text-fg-secondary hover:bg-surface hover:text-fg'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 找到选中片段及其所在轨道类型、同轨片段列表 */
function useSelectedClip(): { clip: Clip; isAudioTrack: boolean; trackClips: Clip[] } | null {
  const timeline = useEditorStore((s) => s.timeline);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  if (!timeline || !selectedClipId) return null;
  for (const track of timeline.tracks) {
    const clip = track.clips.find((c) => c.id === selectedClipId);
    if (clip) return { clip, isAudioTrack: track.kind === 'audio', trackClips: track.clips };
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
  const setClipTransition = useEditorStore((s) => s.setClipTransition);
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

  const { clip, isAudioTrack, trackClips } = selected;
  const t = clip.transform;
  const cid = clip.id;

  // 转场条件：视频轨道 + 存在紧邻的后一片段（才能设转场）。
  const nextClip = findAdjacentNext(trackClips, clip);
  const canTransition = !isAudioTrack && nextClip !== null;

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

            {canTransition && (
              <section className="flex flex-col gap-3.5 border-t border-border-subtle pt-4">
                <h3 className="text-[13px] font-semibold">转场</h3>
                <div className="flex flex-col gap-2">
                  <span className="text-[13px] text-fg-secondary">效果</span>
                  <TransitionSelect
                    value={clip.transitionOut?.type ?? null}
                    onChange={(type) => {
                      if (type === null) {
                        setClipTransition(cid, null);
                      } else {
                        setClipTransition(cid, { type, duration: clip.transitionOut?.duration ?? 0.5 });
                      }
                    }}
                  />
                </div>
                {clip.transitionOut && (
                  <SliderRow
                    label="时长"
                    value={`${clip.transitionOut.duration.toFixed(1)}s`}
                    current={clip.transitionOut.duration}
                    min={0.1}
                    max={2}
                    step={0.1}
                    onChange={(v) => setClipTransition(cid, { ...clip.transitionOut!, duration: v })}
                  />
                )}
                <p className="text-[12px] text-fg-tertiary">
                  转场只在相邻片段间生效。转场期间后一片段显示其首帧渐入，转场结束后正常播放。预览与导出效果一致。
                </p>
              </section>
            )}
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
