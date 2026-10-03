import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Asset, AssetHistoryScope } from '@reel/contracts';
import { AudioLines, Film, Image as ImageIcon, Loader2, Search, X } from 'lucide-react';
import { api } from '../../../lib/api';

const SCOPE_TABS: { value: AssetHistoryScope; label: string }[] = [
  { value: 'all', label: '所有项目' },
  { value: 'canvas', label: '当前项目' },
];

function kindIcon(asset: Asset) {
  if (asset.kind === 'audio') return AudioLines;
  if (asset.kind === 'video') return Film;
  return ImageIcon;
}

export function AssetHistoryDialog({
  canvasId,
  onClose,
  onAddToCanvas,
}: {
  canvasId: string;
  onClose: () => void;
  onAddToCanvas: (asset: Asset) => void;
}) {
  const [scope, setScope] = useState<AssetHistoryScope>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const historyQuery = useQuery<Asset[]>({
    queryKey: ['assetHistory', scope, debouncedSearch],
    queryFn: () =>
      api.assets.history({
        scope,
        canvasId,
        q: debouncedSearch || undefined,
      }) as Promise<Asset[]>,
  });
  const assets = historyQuery.data ?? [];

  const addAsset = (asset: Asset) => {
    if (asset.status !== 'ready') return;
    if (asset.kind !== 'image' && asset.kind !== 'video') return;
    onAddToCanvas(asset);
    onClose();
  };

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 px-5 backdrop-blur-[2px]"
      onPointerDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="历史"
        className="nodrag nopan nowheel flex max-h-[72vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-white/[0.14] bg-[#242424] shadow-[0_28px_80px_rgba(0,0,0,0.62)]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-white/[0.08] p-4 pb-3">
          <div className="flex items-center gap-1" aria-label="历史范围切换">
            {SCOPE_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setScope(tab.value)}
                className={`h-8 rounded-lg px-3 text-xs font-medium transition-colors ${scope === tab.value ? 'bg-[#f3f3f0] text-[#151515]' : 'text-[#a4a4a8] hover:bg-white/[0.07] hover:text-white'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex h-11 items-center gap-2.5 rounded-xl border border-white/[0.12] bg-white/[0.055] px-3 focus-within:border-white/[0.24]">
            <Search className="h-4.5 w-4.5 shrink-0 text-[#85858a]" />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索"
              aria-label="搜索"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#77777c]"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  searchInputRef.current?.focus();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-[#85858a] hover:bg-white/[0.07] hover:text-white"
                aria-label="清空搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="reel-scroll min-h-40 flex-1 overflow-y-auto p-2">
          {historyQuery.isLoading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-[#77777c]" />
            </div>
          ) : assets.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {assets.map((asset) => {
                const KindIcon = kindIcon(asset);
                return (
                  <div key={asset.id} className="group relative" title={asset.prompt ?? asset.name}>
                    <button
                      type="button"
                      onClick={() => addAsset(asset)}
                      className="flex h-[76px] w-full items-center justify-center overflow-hidden rounded-lg bg-white/[0.055] transition-shadow hover:ring-2 hover:ring-[#f3f3f0]/60"
                    >
                      {asset.kind === 'image' && asset.url ? (
                        <img
                          src={asset.url}
                          alt={asset.name}
                          draggable={false}
                          className="h-full w-full object-cover"
                        />
                      ) : asset.kind === 'video' && asset.url ? (
                        <video
                          src={asset.url}
                          draggable={false}
                          className="h-full w-full object-cover"
                          muted
                          preload="metadata"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-1 text-[#9a9a9f]">
                          <KindIcon className="h-[22px] w-[22px]" />
                        </div>
                      )}
                      <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-left text-[10px] text-white">
                        {asset.name}
                      </span>
                    </button>
                    <span
                      aria-label={asset.kind === 'image' ? '图片素材' : asset.kind === 'video' ? '视频素材' : '音频素材'}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-black/65 text-white"
                    >
                      <KindIcon className="h-3 w-3" />
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center text-center">
              <Search className="h-6 w-6 text-[#55555a]" />
              <p className="mt-3 text-sm text-[#9a9a9f]">
                {debouncedSearch ? '没有找到匹配的素材' : '暂无生成记录'}
              </p>
              <p className="mt-1 text-xs text-[#66666b]">
                {debouncedSearch ? '试试其他关键词' : '在画布中生成素材后，这里会展示生成历史'}
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-white/[0.08] px-4 py-2.5 text-xs text-[#66666b]">
          共 {assets.length} 个素材
        </div>
      </section>
    </div>
  );
}
