import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Asset } from '@reel/contracts';
import { AlignLeft, AudioLines, Film, FolderOpen, Image as ImageIcon, Library, Loader2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { MaterialDetailDialog } from './MaterialDetailDialog';
import { AssetLibraryDialog } from '../../canvas/components/AssetLibraryDialog';

const FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
] as const;

type MediaFilter = (typeof FILTERS)[number]['value'];

function dateKey(value: Date | string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function MaterialCard({ asset, onOpen }: { asset: Asset; onOpen: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isPreviewing = useRef(false);
  const playPreview = () => {
    isPreviewing.current = true;
    const video = videoRef.current;
    if (!video) return;
    void video.play().then(() => {
      if (!isPreviewing.current) video.pause();
    }).catch(() => { /* 预览不可播放时继续展示静态缩略图。 */ });
  };
  const stopPreview = () => {
    isPreviewing.current = false;
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
  };
  const Icon = asset.kind === 'video' ? Film : asset.kind === 'audio' ? AudioLines : asset.kind === 'text' ? AlignLeft : ImageIcon;
  return (
    <button type="button" onMouseEnter={playPreview} onMouseLeave={stopPreview} onFocus={playPreview} onBlur={stopPreview} onClick={() => { stopPreview(); onOpen(); }} aria-label={`查看素材：${asset.name}`} className="group min-w-0 cursor-zoom-in overflow-hidden rounded-xl border border-white/[0.10] bg-[#191919] text-left transition-colors hover:border-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/60">
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[#202020]">
        <div className="flex h-full w-full items-center justify-center transition-transform duration-300 ease-out group-hover:scale-105 group-focus-visible:scale-105 motion-reduce:transition-none">
        {asset.kind === 'image' && asset.url ? (
          <img src={asset.url} alt={asset.name} loading="lazy" className="h-full w-full object-contain" />
        ) : asset.kind === 'video' && asset.url ? (
          <video ref={videoRef} src={asset.url} muted loop playsInline preload="metadata" className="pointer-events-none h-full w-full object-contain" />
        ) : asset.kind === 'audio' ? (
          <div className="flex w-full min-w-0 flex-col items-center gap-5 px-3">
            <AudioLines className="h-9 w-9 text-[#77777c]" />
          </div>
        ) : asset.kind === 'text' ? (
          <p className="line-clamp-5 whitespace-pre-wrap px-4 text-sm leading-6 text-[#b9b9ba]">{asset.content ?? asset.name}</p>
        ) : (
          <Icon className="h-9 w-9 text-[#77777c]" />
        )}
        </div>
      </div>
    </button>
  );
}

export function AssetsView({ isAuthenticated, isAuthLoading, creatorName, onLogin }: {
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  creatorName?: string;
  onLogin: () => void;
}) {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<'materials' | 'assets'>('materials');
  const [filter, setFilter] = useState<MediaFilter>('all');
  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const [libraryToast, setLibraryToast] = useState<string | null>(null);
  useEffect(() => {
    if (!libraryToast) return;
    const timeout = window.setTimeout(() => setLibraryToast(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [libraryToast]);
  const history = useQuery<Asset[]>({
    queryKey: ['assetHistory', 'home', 'all'],
    queryFn: () => api.assets.history({ scope: 'all' }) as Promise<Asset[]>,
    enabled: isAuthenticated && section === 'materials',
  });
  const groups = useMemo(() => {
    const byDay = new Map<string, Asset[]>();
    const assets = (history.data ?? [])
      .filter((asset) => filter === 'all' || asset.kind === filter)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    for (const asset of assets) {
      const day = dateKey(asset.createdAt);
      const group = byDay.get(day);
      if (group) group.push(asset);
      else byDay.set(day, [asset]);
    }
    return [...byDay.entries()];
  }, [history.data, filter]);

  return (
    <main className="flex min-h-0 flex-1 bg-[#050505]">
      <aside className="w-28 shrink-0 border-r border-white/[0.08] px-2 py-7 sm:w-48 sm:px-4">
        <nav aria-label="资产二级导航" className="flex flex-col gap-2">
          {([
            { value: 'materials', label: '素材库', icon: Library },
            { value: 'assets', label: '资产库', icon: FolderOpen },
          ] as const).map(({ value, label, icon: Icon }) => (
            <button key={value} type="button" onClick={() => setSection(value)} aria-current={section === value ? 'page' : undefined}
              className={`flex h-11 items-center gap-2 rounded-lg px-3 text-sm transition-colors sm:gap-3 ${section === value ? 'bg-white/[0.10] font-semibold text-[#f7f7f2]' : 'text-[#8e8e92] hover:bg-white/[0.05] hover:text-[#f7f7f2]'}`}>
              <Icon className="h-4 w-4 shrink-0" />{label}
            </button>
          ))}
        </nav>
      </aside>

      <section aria-label={section === 'materials' ? '素材库' : '资产库'} className="flex min-w-0 flex-1 flex-col">
        {(section === 'materials' || !isAuthenticated || isAuthLoading) && <div className="shrink-0 px-4 pt-8 sm:px-8 lg:px-10">
          <h1 className="text-xl font-semibold text-[#f7f7f2]">{section === 'materials' ? '素材库' : '资产库'}</h1>
          {section === 'materials' && (
            <div className="mt-6 flex gap-1 border-b border-white/[0.08] pb-4" role="group" aria-label="素材类型筛选">
              {FILTERS.map(({ value, label }) => (
                <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value}
                  className={`h-9 rounded-lg px-3 text-sm transition-colors sm:px-5 ${filter === value ? 'bg-white/[0.12] font-medium text-[#f7f7f2]' : 'text-[#8e8e92] hover:bg-white/[0.05] hover:text-[#f7f7f2]'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>}

        {isAuthLoading || (section === 'materials' && isAuthenticated && history.isLoading) ? (
          <div role="status" aria-label="正在加载素材" className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#77777c]" /></div>
        ) : !isAuthenticated ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 pb-16 text-center">
            <p className="text-sm text-[#9a9a9f]">{section === 'assets' ? '登录后查看资产库' : '登录后查看历史生成的素材'}</p>
            <button type="button" onClick={onLogin} className="h-10 rounded-lg border border-white/[0.16] px-5 text-sm text-[#f7f7f2] hover:bg-white/[0.08]">登录</button>
          </div>
        ) : section === 'assets' ? (
          <AssetLibraryDialog embedded onClose={() => {}} onToast={setLibraryToast} onSelectAsset={setDetailAsset} />
        ) : history.isError ? (
          <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 px-4 pb-16 text-center">
            <p className="text-sm text-[#9a9a9f]">素材加载失败，请重试</p>
            <button type="button" onClick={() => void history.refetch()} className="h-9 rounded-lg border border-white/[0.16] px-4 text-sm text-[#f7f7f2] hover:bg-white/[0.08]">重新加载</button>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4 pb-16 text-center">
            <Library className="mb-5 h-12 w-12 text-[#55555a]" strokeWidth={1.3} />
            <p className="text-[16px] text-fg-secondary">暂无素材</p>
          </div>
        ) : (
          <div className="reel-scroll min-h-0 flex-1 space-y-8 overflow-y-auto px-4 py-6 sm:px-8 lg:px-10">
            {groups.map(([day, assets]) => (
              <section key={day} aria-label={day}>
                <div className="mb-4 flex items-center gap-4">
                  <h2 className="shrink-0 text-sm font-medium text-[#b9b9ba]">{day}</h2>
                  <div className="h-px flex-1 bg-white/[0.08]" />
                  <span className="text-xs text-[#66666b]">{assets.length} 个素材</span>
                </div>
                <div className="grid gap-4 [--material-columns:1] sm:[--material-columns:2] lg:[--material-columns:3] xl:[--material-columns:4] 2xl:[--material-columns:5]"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, min(100%, calc((100% - (var(--material-columns) - 1) * 1rem) / var(--material-columns) * 0.7)))' }}>
                  {assets.map((asset) => <MaterialCard key={asset.id} asset={asset} onOpen={() => setDetailAsset(asset)} />)}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
      {libraryToast && <div role="status" className="fixed bottom-8 left-1/2 z-[80] -translate-x-1/2 rounded-xl border border-white/10 bg-[#292929] px-4 py-3 text-sm text-white shadow-xl">{libraryToast}</div>}
      {detailAsset && <MaterialDetailDialog key={detailAsset.id} asset={detailAsset} creatorName={creatorName} onClose={() => setDetailAsset(null)}
        onDelete={section === 'assets' ? async (asset) => {
          await api.assets.remove(asset.id);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['assetFolders'] }),
            queryClient.invalidateQueries({ queryKey: ['assetHistory'] }),
          ]);
          setLibraryToast('资产已删除');
        } : undefined} />}
    </main>
  );
}
