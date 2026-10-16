import { useId, useRef, useState } from 'react';
import type { AssetReference } from '@reel/contracts';
import { AlignLeft, AudioLines, Film, Image as ImageIcon } from 'lucide-react';

export function MaterialReferenceChip({ reference }: { reference: AssetReference }) {
  const [preview, setPreview] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const previewId = useId();
  const Icon = { text: AlignLeft, image: ImageIcon, video: Film, audio: AudioLines }[reference.kind];
  const showPreview = () => {
    const bounds = buttonRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setPreview({ left: Math.max(12, Math.min(bounds.left, window.innerWidth - 300)), top: Math.max(12, Math.min(bounds.bottom, window.innerHeight - 280)) });
  };

  return (
    <div className="inline-flex" onMouseEnter={showPreview} onMouseLeave={() => setPreview(null)} onFocus={showPreview} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPreview(null); }}>
      <button ref={buttonRef} type="button" aria-label={`预览参考：${reference.name}`} aria-describedby={preview ? previewId : undefined} onClick={() => preview ? setPreview(null) : showPreview()}
        className="flex h-9 max-w-[180px] items-center gap-2 overflow-hidden rounded-lg border border-white/10 bg-white/[0.05] px-2 text-xs text-[#b9b9bf] hover:border-white/25 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/60">
        {reference.kind === 'image' && reference.url ? <img src={reference.url} alt="" className="h-6 w-6 shrink-0 rounded object-cover" /> : <Icon className="h-4 w-4 shrink-0" />}
        <span className="truncate">{reference.name}</span>
      </button>
      {preview && (
        <div id={previewId} ref={(element) => {
          if (!element) return;
          element.setAttribute('popover', 'manual');
          if (!element.matches(':popover-open')) element.showPopover();
        }} role="tooltip" aria-label={reference.name}
          className="fixed m-0 w-[280px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-white/15 bg-[#252525] p-3 text-white shadow-2xl" style={{ left: preview.left, top: preview.top }}>
          <p className="mb-2 truncate text-xs font-medium text-[#b9b9bf]">{reference.name}</p>
          {reference.kind === 'image' && reference.url ? <img src={reference.url} alt={reference.name} className="max-h-52 w-full rounded-lg object-contain" />
            : reference.kind === 'video' && reference.url ? <video src={reference.url} muted autoPlay loop playsInline className="max-h-52 w-full rounded-lg object-contain" />
              : reference.kind === 'audio' && reference.url ? <audio src={reference.url} controls className="w-full" aria-label={reference.name} />
                : <div className="reel-scroll max-h-52 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-[#dedee0]">{reference.content || '暂无参考内容'}</div>}
        </div>
      )}
    </div>
  );
}
