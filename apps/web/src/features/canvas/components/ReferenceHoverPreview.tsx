import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import type { Asset } from '@reel/contracts';
import { api } from '../../../lib/api';
import type { CanvasChatReference } from '../chat-types';
import { readableReferences } from '../inline-references';
import { AudioNodePlayer } from './AudioNodePlayer';

type Preview = { reference: CanvasChatReference; anchor: HTMLElement; available: boolean };

export function useReferenceHoverPreview(variant: 'node' | 'chat' = 'node') {
  const [current, setCurrent] = useState<Preview | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const keepOpen = () => clearTimeout(timer.current);
  const hide = () => { keepOpen(); timer.current = setTimeout(() => setCurrent(null), 120); };
  const close = () => { keepOpen(); setCurrent(null); };
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    show: (reference: CanvasChatReference, anchor: HTMLElement, available = true) => {
      keepOpen();
      setCurrent({ reference, anchor, available });
    },
    hide,
    close,
    preview: current && <ReferenceHoverPreview {...current} variant={variant} onMouseEnter={keepOpen} onMouseLeave={hide} onClose={close} />,
  };
}

function ReferenceHoverPreview({ reference, anchor, available, variant, onMouseEnter, onMouseLeave, onClose }: Preview & {
  variant: 'node' | 'chat';
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClose: () => void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const asset = useQuery<Asset>({
    queryKey: ['asset', reference.assetId],
    queryFn: () => api.assets.get(reference.assetId!) as Promise<Asset>,
    enabled: available && reference.kind !== 'text' && !!reference.assetId && !reference.url,
  });
  const source = reference.url || asset.data?.url;
  useLayoutEffect(() => {
    if (!popup.current || !anchor.isConnected) return;
    const place = () => {
      if (!popup.current) return;
      const bounds = anchor.getBoundingClientRect();
      const { width, height } = popup.current.getBoundingClientRect();
      const gap = variant === 'node' ? 6 : 8;
      setPosition({
        left: Math.max(8, Math.min(bounds.left + bounds.width / 2 - width / 2, window.innerWidth - width - 8)),
        top: bounds.top >= height + 16 ? bounds.top - height - gap : Math.max(8, Math.min(bounds.bottom + gap, window.innerHeight - height - 8)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(popup.current);
    return () => observer.disconnect();
  }, [anchor, source, reference, available, variant]);
  useEffect(() => {
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  if (!anchor.isConnected) return null;
  return createPortal(<div ref={popup} role="tooltip" aria-label={`预览：${reference.title}`}
    onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onPointerDown={(event) => event.stopPropagation()}
    className={`nodrag nopan nowheel fixed z-[10000] max-w-[calc(100vw-24px)] overflow-hidden ${variant === 'node'
      ? 'w-[200px] rounded-lg border border-white/15 bg-[#252525] p-2 text-white shadow-lg'
      : 'w-60 rounded-xl border border-white/[0.18] bg-[#202020] p-1.5 text-[#dededb] shadow-[0_16px_40px_rgba(0,0,0,0.55)]'}`} style={position}>
    {!available ? <p className="text-xs leading-5">节点已删除</p> : reference.kind === 'text'
      ? <div className="reel-scroll max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-[#dedee0]">{readableReferences(reference.content || reference.prompt || '暂无文本内容')}</div>
      : source ? reference.kind === 'image'
        ? <img src={source} alt={reference.title} className={variant === 'node' ? 'max-h-32 w-full rounded object-contain' : 'h-36 w-full rounded-lg bg-black object-contain'} />
        : reference.kind === 'audio' ? <div className="h-24"><AudioNodePlayer key={source} src={source} title={reference.title} autoPlay previewOnly /></div>
        : <video src={source} autoPlay muted loop playsInline preload="metadata" className={variant === 'node' ? 'max-h-32 w-full rounded object-contain' : 'h-36 w-full rounded-lg bg-black object-contain'} />
        : <p className="text-xs leading-5">素材暂无可预览内容</p>}
  </div>, document.body);
}
