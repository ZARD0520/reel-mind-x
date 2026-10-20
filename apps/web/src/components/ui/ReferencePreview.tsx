import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { AssetReference } from '@reel/contracts';
import { AudioNodePlayer } from '../../features/canvas/components/AudioNodePlayer';

export function ReferencePreview({ reference, children }: { reference: AssetReference; children: ReactNode }) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const previewId = useId();
  const hideTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null);
  const show = () => {
    window.clearTimeout(hideTimer.current);
    const bounds = anchorRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = Math.min(200, window.innerWidth - 24);
    setPosition({
      left: Math.max(12, Math.min(bounds.left + bounds.width / 2 - width / 2, window.innerWidth - width - 12)),
      bottom: window.innerHeight - bounds.top + 6,
    });
  };
  const hide = () => { hideTimer.current = window.setTimeout(() => setPosition(null), 150); };

  return (
    <div ref={anchorRef} className="inline-flex min-w-0 shrink-0" onMouseEnter={show} onMouseLeave={hide} onFocus={show}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPosition(null); }} aria-describedby={position ? previewId : undefined}>
      {children}
      {position && (
        <div id={previewId} role="tooltip" aria-label={`预览：${reference.name}`} ref={(element) => {
          if (!element) return;
          element.setAttribute('popover', 'auto');
          if (!element.matches(':popover-open')) element.showPopover();
        }} className="nodrag nopan nowheel fixed m-0 w-[200px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-white/15 bg-[#252525] p-2 text-white shadow-lg"
          style={{ left: position.left, top: 'auto', bottom: position.bottom }} onPointerDown={(event) => event.stopPropagation()}>
          {reference.kind === 'image' && reference.url ? <img src={reference.url} alt={reference.name} className="max-h-32 w-full rounded object-contain" />
            : reference.kind === 'video' && reference.url ? <video src={reference.url} muted autoPlay loop playsInline className="max-h-32 w-full rounded object-contain" />
              : reference.kind === 'audio' && reference.url ? <div className="h-24"><AudioNodePlayer key={reference.url} src={reference.url} title={reference.name} autoPlay previewOnly /></div>
                : <div className="reel-scroll max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-[#dedee0]">{reference.kind === 'text' ? reference.content || '暂无文本内容' : '素材暂无可预览内容'}</div>}
        </div>
      )}
    </div>
  );
}
