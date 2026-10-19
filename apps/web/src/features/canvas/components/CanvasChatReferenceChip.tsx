import { FileText, Film, Image as ImageIcon, Music, X } from 'lucide-react';
import type { CanvasChatReference } from '../chat-types';
import { useReferenceHoverPreview } from './ReferenceHoverPreview';

export function CanvasChatReferenceChip({ reference, available, onFocusNode, onRemove }: {
  reference: CanvasChatReference;
  available: boolean;
  onFocusNode: (nodeId: string) => void;
  onRemove?: () => void;
}) {
  const hover = useReferenceHoverPreview('chat');
  const Icon = { text: FileText, image: ImageIcon, video: Film, audio: Music }[reference.kind];
  return <>
    <span onMouseEnter={(event) => hover.show(reference, event.currentTarget, available)} onMouseLeave={hover.hide}
      onFocus={(event) => hover.show(reference, event.currentTarget, available)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hover.hide(); }}
      className={`inline-flex max-w-full items-center rounded-md align-middle text-xs transition-colors ${available ? 'bg-white/[0.12] text-[#dededb] hover:bg-white/[0.20] focus-within:bg-white/[0.20]' : 'bg-white/[0.05] text-[#77777c] hover:bg-white/[0.07]'}`}>
      <button type="button" disabled={!available} onClick={() => { hover.close(); onFocusNode(reference.id); }}
        aria-label={available ? `定位到画布节点 ${reference.title}` : `${reference.title}，节点已删除`}
        className="inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-left disabled:cursor-default focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/60">
        <Icon className="h-3.5 w-3.5 shrink-0" /><span className="max-w-44 truncate">{reference.title}</span>
      </button>
      {onRemove && <button type="button" onClick={onRemove} aria-label={`移除引用${reference.title}`} className="mr-1 cursor-pointer rounded p-0.5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/60"><X className="h-3 w-3" /></button>}
    </span>
    {hover.preview}
  </>;
}
