import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Asset } from '@reel/contracts';
import { AudioLines, Film, FolderOpen, Image as ImageIcon, Library, Loader2, Upload } from 'lucide-react';
import { api } from '../../../lib/api';

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

function MaterialCard({ asset }: { asset: Asset }) {
  const Icon = asset.kind === 'video' ? Film : asset.kind === 'audio' ? AudioLines : ImageIcon;
  return (
    <article className="min-w-0 overflow-hidden rounded-xl border border-white/[0.10] bg-[#191919]" title={asset.prompt ?? asset.name}>
      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[#202020]">
        {asset.kind === 'image' && asset.url ? (
          <img src={asset.url} alt={asset.name} loading="lazy" className="h-full w-full object-contain" />
        ) : asset.kind === 'video' && asset.url ? (
          <video src={asset.url} controls preload="metadata" className="h-full w-full object-contain" />
        ) : asset.kind === 'audio' ? (
          <div className="flex w-full min-w-0 flex-col items-center gap-5 px-3">
            <AudioLines className="h-9 w-9 text-[#77777c]" />
            {asset.url && <audio src={asset.url} controls preload="none" aria-label={asset.name} className="h-8 w-full" />}
          </div>
        ) : asset.kind === 'text' ? (
          <p className="line-clamp-5 whitespace-pre-wrap px-4 text-sm leading-6 text-[#b9b9ba]">{asset.content ?? asset.name}</p>
        ) : (
          <Icon className="h-9 w-9 text-[#77777c]" />
        )}
      </div>
      <p className="truncate px-3 py-3 text-sm text-[#d7d7da]">{asset.name}</p>
    </article>
  );
}

export function AssetsView({ isAuthenticated, isAuthLoading, onLogin }: {
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  onLogin: () => void;
}) {
  const [section, setSection] = useState<'materials' | 'assets'>('materials');
  const [filter, setFilter] = useState<MediaFilter>('all');
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
        <div className="shrink-0 px-4 pt-8 sm:px-8 lg:px-10">
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
        </div>

        {section === 'assets' ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4 pb-16 text-center">
            <FolderOpen className="mb-5 h-12 w-12 text-[#55555a]" strokeWidth={1.3} />
            <p className="text-[16px] text-fg-secondary">当前暂无资产</p>
            <button type="button" className="mt-5 flex h-10 items-center gap-2 rounded-lg bg-[#f7f7f2] px-5 text-sm font-semibold text-[#151515] transition-colors hover:bg-white">
              <Upload className="h-4 w-4" />点击上传资产
            </button>
          </div>
        ) : isAuthLoading || (isAuthenticated && history.isLoading) ? (
          <div role="status" aria-label="正在加载素材" className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#77777c]" /></div>
        ) : !isAuthenticated ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 pb-16 text-center">
            <p className="text-sm text-[#9a9a9f]">登录后查看历史生成的素材</p>
            <button type="button" onClick={onLogin} className="h-10 rounded-lg border border-white/[0.16] px-5 text-sm text-[#f7f7f2] hover:bg-white/[0.08]">登录</button>
          </div>
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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {assets.map((asset) => <MaterialCard key={asset.id} asset={asset} />)}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
