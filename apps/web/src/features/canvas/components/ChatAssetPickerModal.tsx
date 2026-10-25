import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, FileText, Loader2, X } from 'lucide-react';
import type { Asset } from '@reel/contracts';
import { api } from '../../../lib/api';
import type { CanvasChatReference } from '../chat-types';

type PickerTab = 'materials' | 'library' | 'uploads';

type PickerItem = CanvasChatReference & { meta?: string };

const TABS: { value: PickerTab; label: string }[] = [
  { value: 'materials', label: '素材库' },
  { value: 'library', label: '资产库' },
  { value: 'uploads', label: '我上传的' },
];

const EMPTY_TEXT: Record<PickerTab, string> = {
  materials: '素材库中还没有可添加的素材',
  library: '资产库中还没有可添加的素材',
  uploads: '本次会话还没有上传过素材',
};

const kindLabel = (kind: string) => (kind === 'text' ? '文本' : kind === 'image' ? '图片' : kind === 'audio' ? '音频' : '视频');

function isAttachable(asset: { kind: string; status: string; url: string | null; content: string | null }): boolean {
  if (asset.status !== 'ready') return false;
  if (asset.kind === 'image') return !!asset.url;
  if (asset.kind === 'text') return !!asset.content;
  return false;
}

/** 聊天「添加素材」弹窗：素材库（生成历史）/ 资产库（文件夹素材）/ 我上传的（本次会话上传），勾选后确认加入输入框 */
export function ChatAssetPickerModal({ open, uploads, draftIds, onClose, onConfirm }: {
  open: boolean;
  uploads: CanvasChatReference[];
  draftIds: ReadonlySet<string>;
  onClose: () => void;
  onConfirm: (references: CanvasChatReference[]) => void;
}) {
  const [tab, setTab] = useState<PickerTab>('materials');
  const [selected, setSelected] = useState<CanvasChatReference[]>([]);

  const history = useQuery({
    queryKey: ['chat-picker-history'],
    queryFn: () => api.assets.history({ scope: 'all' }) as Promise<Asset[]>,
    enabled: open && tab === 'materials',
  });
  const library = useQuery({
    queryKey: ['chat-picker-library'],
    queryFn: async (): Promise<PickerItem[]> => {
      const folders = await api.assetFolders.list('personal') as { id: string; name: string }[];
      const lists = await Promise.all(folders.map((folder) => api.assetFolders.listAssets(folder.id)));
      return folders.flatMap((folder, index) =>
        ((lists[index] ?? []) as Asset[])
          .filter((asset) => isAttachable(asset))
          .map((asset) => ({
            id: asset.id,
            kind: asset.kind as 'image' | 'text',
            title: asset.name,
            assetId: asset.id,
            url: asset.url ?? undefined,
            content: asset.content ?? undefined,
            meta: folder.name,
          })),
      );
    },
    enabled: open && tab === 'library',
  });

  const items: PickerItem[] =
    tab === 'materials'
      ? (history.data ?? [])
          .filter((asset) => isAttachable(asset))
          .map((asset) => ({
            id: asset.id,
            kind: asset.kind as 'image' | 'text',
            title: asset.name,
            assetId: asset.id,
            url: asset.url ?? undefined,
            content: asset.content ?? undefined,
            meta: kindLabel(asset.kind),
          }))
      : tab === 'library'
        ? library.data ?? []
        : uploads.map((reference) => ({ ...reference, meta: '本次上传' }));

  const isLoading = tab === 'materials' ? history.isPending : tab === 'library' ? library.isPending : false;

  function toggle(item: PickerItem) {
    if (draftIds.has(item.id)) return;
    setSelected((current) => {
      const exists = current.some((reference) => reference.id === item.id);
      return exists ? current.filter((reference) => reference.id !== item.id) : [...current, { ...item }];
    });
  }

  function confirm() {
    if (!selected.length) return;
    onConfirm(selected);
    setSelected([]);
  }

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="添加素材" className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div className="flex h-[460px] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#1d1d1d] shadow-[0_28px_90px_rgba(0,0,0,0.6)]" onClick={(event) => event.stopPropagation()}>
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.09] px-4">
          <h2 className="text-[15px] font-semibold text-[#f3f3f0]">添加素材</h2>
          <button type="button" aria-label="关闭" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#9b9b9f] hover:bg-white/[0.08] hover:text-white"><X className="h-[18px] w-[18px]" /></button>
        </header>
        <div className="flex min-h-0 flex-1">
          <nav className="w-28 shrink-0 border-r border-white/[0.09] p-2" aria-label="素材来源">
            {TABS.map(({ value, label }) => (
              <button type="button" key={value} onClick={() => setTab(value)} aria-current={tab === value ? 'page' : undefined}
                className={`mb-1 flex h-10 w-full items-center gap-2 rounded-lg px-3 text-sm transition-colors ${tab === value ? 'bg-white/[0.10] font-medium text-[#f7f7f2]' : 'text-[#8e8e92] hover:bg-white/[0.05] hover:text-[#f7f7f2]'}`}>
                {label}
              </button>
            ))}
          </nav>
          <div className="reel-scroll min-h-0 flex-1 overflow-y-auto p-2">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-xs text-[#92929f]"><Loader2 className="h-4 w-4 animate-spin" /> 加载中…</div>
            ) : items.length ? (
              items.map((item) => {
                const added = draftIds.has(item.id);
                const checked = selected.some((reference) => reference.id === item.id);
                return (
                  <button type="button" key={item.id} disabled={added}
                    onClick={() => toggle(item)}
                    className={`mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${added ? 'cursor-not-allowed opacity-40' : checked ? 'bg-white/[0.10]' : 'cursor-pointer hover:bg-white/[0.06]'}`}>
                    <span aria-hidden="true" className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${checked ? 'border-[#f7f7f2] bg-[#f7f7f2] text-[#111]' : 'border-white/[0.25]'}`}>
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    {item.kind === 'text' ? (
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/[0.08] bg-[#202027] text-[#9a9a9f]"><FileText className="h-4 w-4" /></span>
                    ) : item.url ? (
                      <img src={item.url} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-md border border-white/[0.08] object-cover" />
                    ) : (
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/[0.08] bg-[#202027] text-[#9a9a9f]"><FileText className="h-4 w-4" /></span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[#dededb]">{item.title}</span>
                      <span className="block text-[10px] text-[#77777c]">{item.meta ?? kindLabel(item.kind)}</span>
                    </span>
                    {added && <span className="shrink-0 text-[10px] text-[#77777c]">已添加</span>}
                  </button>
                );
              })
            ) : (
              <p className="px-3 py-10 text-center text-xs text-[#929296]">{EMPTY_TEXT[tab]}</p>
            )}
          </div>
        </div>
        <footer className="flex h-14 shrink-0 items-center justify-between border-t border-white/[0.09] px-4">
          <span className="text-xs text-[#8e8e92]">已选择 {selected.length} 项</span>
          <button type="button" disabled={!selected.length} onClick={confirm}
            className="flex h-9 items-center justify-center rounded-lg bg-[#f7f7f2] px-4 text-sm font-medium text-[#111] transition-colors hover:bg-[#deded9] disabled:cursor-not-allowed disabled:bg-white/[0.10] disabled:text-white/30">
            {selected.length ? `确认添加（${selected.length}）` : '确认添加'}
          </button>
        </footer>
      </div>
    </div>
  );
}
