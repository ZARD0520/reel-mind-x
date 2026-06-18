import { useRef, useState } from 'react';
import { AudioLines, Film, Image as ImageIcon, Loader2, Music, Plus, Sparkles, Sticker, Type, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Asset } from '@reel/contracts';
import { useAssets, useDeleteAsset, useUploadAsset } from '../hooks';
import { useEditorStore } from '../store';

const TABS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'media', label: '媒体', icon: Film },
  { key: 'audio', label: '音频', icon: Music },
  { key: 'text', label: '文本', icon: Type },
  { key: 'sticker', label: '贴纸', icon: Sticker },
  { key: 'effect', label: '特效', icon: Sparkles },
];

function AssetThumb({
  asset,
  onAdd,
  onDelete,
}: {
  asset: Asset;
  onAdd: () => void;
  onDelete: () => void;
}) {
  const Icon = asset.kind === 'audio' ? AudioLines : asset.kind === 'image' ? ImageIcon : Film;
  return (
    <div
      className="group relative"
      draggable={asset.status === 'ready'}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-reel-asset', asset.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <button
        type="button"
        onClick={onAdd}
        title={`添加 ${asset.name}（可拖到时间轴）`}
        className="flex h-[76px] w-full items-center justify-center overflow-hidden rounded-lg bg-input hover:ring-2 hover:ring-accent"
      >
        {asset.kind === 'image' && asset.url ? (
          <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />
        ) : asset.kind === 'video' && asset.url ? (
          <video src={asset.url} className="h-full w-full object-cover" muted preload="metadata" />
        ) : (
          <Icon className="h-[22px] w-[22px] text-fg-tertiary" />
        )}
        <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-[10px] text-fg">
          {asset.name}
        </span>
      </button>
      {/* 删除按钮：hover 时出现 */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="删除素材"
        className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded bg-black/70 text-white hover:bg-red-500 group-hover:flex"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

export function LeftPanel() {
  const [active, setActive] = useState('media');
  const fileInput = useRef<HTMLInputElement>(null);
  const { data: assets = [] } = useAssets();
  const upload = useUploadAsset();
  const deleteAsset = useDeleteAsset();
  const addAsset = useEditorStore((s) => s.addAsset);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = '';
  };

  return (
    <div className="flex h-full border-r border-border-subtle bg-surface">
      <nav className="flex w-[72px] flex-col items-center gap-1.5 bg-base py-3">
        {TABS.map(({ key, label, icon: Icon }) => {
          const isActive = key === active;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              className={`flex w-14 flex-col items-center justify-center gap-1 rounded-lg py-2 ${
                isActive ? 'bg-accent-soft text-accent' : 'text-fg-secondary hover:bg-elevated'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[11px] font-medium">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex w-[300px] flex-col gap-4 p-4">
        {active !== 'media' ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <span className="text-[15px] font-medium text-fg-secondary">敬请期待</span>
            <span className="text-[13px] text-fg-tertiary">
              {TABS.find((t) => t.key === active)?.label}功能开发中
            </span>
          </div>
        ) : (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="video/*,image/*,audio/*"
              className="hidden"
              onChange={onPick}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={upload.isPending}
              className="flex h-24 flex-col items-center justify-center gap-2 rounded-[10px] border border-border-subtle bg-input hover:border-accent disabled:opacity-60"
            >
              {upload.isPending ? (
                <Loader2 className="h-[26px] w-[26px] animate-spin text-accent" />
              ) : (
                <Plus className="h-[26px] w-[26px] text-accent" />
              )}
              <span className="text-[13px] font-medium text-fg-secondary">
                {upload.isPending ? '上传中…' : '导入素材'}
              </span>
            </button>

            <h2 className="text-[13px] font-semibold">本地素材</h2>
            {assets.length === 0 ? (
              <p className="text-[13px] text-fg-tertiary">还没有素材，点上方导入</p>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 overflow-y-auto">
                {assets.map((asset) => (
                  <AssetThumb
                    key={asset.id}
                    asset={asset}
                    onAdd={() => addAsset(asset)}
                    onDelete={() => deleteAsset.mutate(asset.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
