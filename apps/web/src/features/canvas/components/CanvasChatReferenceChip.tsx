import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, Film, Image as ImageIcon, X } from 'lucide-react';
import type { Asset } from '@reel/contracts';
import { api } from '../../../lib/api';
import type { CanvasChatReference } from '../chat-types';

const icons = { text: FileText, image: ImageIcon, video: Film };

export function CanvasChatReferenceChip({ reference, available, onFocusNode, onRemove }: {
  reference: CanvasChatReference;
  available: boolean;
  onFocusNode: (nodeId: string) => void;
  onRemove?: () => void;
}) {
  const [previewPosition, setPreviewPosition] = useState<{ left: number; top: number } | null>(null);
  const asset = useQuery<Asset>({
    queryKey: ['asset', reference.assetId],
    queryFn: () => api.assets.get(reference.assetId!) as Promise<Asset>,
    enabled: available && !!previewPosition && reference.kind !== 'text' && !!reference.assetId && !reference.url,
  });
  const source = reference.url || asset.data?.url;
  const Icon = icons[reference.kind];

  function showPreview(element: HTMLElement) {
    const bounds = element.getBoundingClientRect();
    if (!available) {
      setPreviewPosition({
        left: Math.max(8, Math.min(bounds.left + bounds.width / 2 - 48, window.innerWidth - 104)),
        top: bounds.top >= 44 ? bounds.top - 36 : bounds.bottom + 8,
      });
      return;
    }
    if (reference.kind === 'text') return;
    setPreviewPosition({
      left: Math.max(8, Math.min(bounds.left + bounds.width / 2 - 120, window.innerWidth - 248)),
      top: bounds.top >= 184 ? bounds.top - 176 : bounds.bottom + 8,
    });
  }

  return <>
    <span onMouseEnter={(event) => showPreview(event.currentTarget)} onMouseLeave={() => setPreviewPosition(null)} onFocus={(event) => showPreview(event.currentTarget)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPreviewPosition(null); }} className={`inline-flex max-w-full items-center rounded-md text-xs transition-colors ${available ? 'bg-white/[0.12] text-[#dededb] hover:bg-white/[0.20] focus-within:bg-white/[0.20]' : 'bg-white/[0.05] text-[#77777c] hover:bg-white/[0.07]'}`}>
      <button type="button" disabled={!available} onClick={() => { setPreviewPosition(null); onFocusNode(reference.id); }} aria-label={available ? `定位到画布节点 ${reference.title}` : `${reference.title}，节点已删除`} title={available ? `定位到画布节点：${reference.title}` : undefined} className="inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-left disabled:cursor-default focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/60">
        <Icon className="h-3.5 w-3.5 shrink-0" /><span className="max-w-44 truncate">{reference.title}</span>
      </button>
      {onRemove && <button type="button" onClick={onRemove} aria-label={`移除引用${reference.title}`} className="mr-1 cursor-pointer rounded p-0.5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/60"><X className="h-3 w-3" /></button>}
    </span>
    {previewPosition && !available && createPortal(
      <div role="tooltip" className="pointer-events-none fixed z-[100] rounded-md border border-white/[0.12] bg-[#282828] px-2.5 py-1.5 text-xs text-[#c2c2c5] shadow-lg" style={previewPosition}>节点已删除</div>, document.body,
    )}
    {previewPosition && available && reference.kind !== 'text' && source && createPortal(
      <div role="tooltip" className="pointer-events-none fixed z-[100] w-60 overflow-hidden rounded-xl border border-white/[0.18] bg-[#202020] p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.55)]" style={previewPosition}>
        {reference.kind === 'image'
          ? <img src={source} alt={reference.title} className="h-36 w-full rounded-lg bg-black object-contain" />
          : <video src={source} autoPlay muted loop playsInline preload="metadata" className="h-36 w-full rounded-lg bg-black object-contain" />}
        <div className="truncate px-1 pt-1 text-xs text-[#dededb]">{reference.title}</div>
      </div>, document.body,
    )}
  </>;
}
