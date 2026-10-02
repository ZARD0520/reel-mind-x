import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Asset, AssetFolder } from '@reel/contracts';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Loader2,
  X,
} from 'lucide-react';
import { api } from '../../../lib/api';
import { apiErrorMessage } from './AssetLibraryDialog';

interface PickerRow {
  folder: AssetFolder;
  depth: number;
  hasChildren: boolean;
}

export function AssetFolderPickerDialog({
  assetId,
  assetName,
  onClose,
  onSaved,
}: {
  assetId: string;
  /** 保存时作为素材库名称的展示名（如画布节点名） */
  assetName?: string;
  onClose: () => void;
  onSaved: (folderName: string) => void;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const foldersQuery = useQuery<AssetFolder[]>({
    queryKey: ['assetFolders', 'personal'],
    queryFn: () => api.assetFolders.list('personal') as Promise<AssetFolder[]>,
  });
  const folders = foldersQuery.data ?? [];

  // 展开状态驱动：按层级展开出当前可见的文件夹行
  const rows = useMemo<PickerRow[]>(() => {
    const byParent = new Map<string, AssetFolder[]>();
    for (const folder of folders) {
      const key = folder.parentId ?? '';
      const list = byParent.get(key) ?? [];
      list.push(folder);
      byParent.set(key, list);
    }
    const result: PickerRow[] = [];
    const walk = (parentKey: string, depth: number) => {
      for (const folder of byParent.get(parentKey) ?? []) {
        const children = byParent.get(folder.id) ?? [];
        result.push({ folder, depth, hasChildren: children.length > 0 });
        if (expanded.has(folder.id)) walk(folder.id, depth + 1);
      }
    };
    walk('', 0);
    return result;
  }, [folders, expanded]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleExpanded = (folderId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const save = useMutation({
    mutationFn: (folderId: string) =>
      api.assets.saveToLibrary(assetId, folderId, assetName) as Promise<Asset>,
    onSuccess: (_asset, folderId) => {
      const folder = folders.find((item) => item.id === folderId);
      void queryClient.invalidateQueries({ queryKey: ['assetFolders'] });
      onSaved(folder?.name ?? '素材库');
    },
    onError: (error) => setActionError(apiErrorMessage(error, '保存失败，请稍后重试')),
  });

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 px-5 backdrop-blur-[2px]"
      onPointerDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="保存到素材库"
        className="nodrag nopan nowheel flex max-h-[72vh] w-full max-w-[440px] flex-col overflow-hidden rounded-2xl border border-white/[0.14] bg-[#242424] shadow-[0_28px_80px_rgba(0,0,0,0.62)]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
          <h2 className="text-sm font-semibold text-[#eeeeef]">保存到素材库</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[#85858a] hover:bg-white/[0.07] hover:text-white"
            aria-label="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="reel-scroll min-h-40 flex-1 overflow-y-auto p-2">
          {foldersQuery.isLoading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-[#77777c]" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center text-center">
              <FolderPlus className="h-6 w-6 text-[#55555a]" />
              <p className="mt-3 text-sm text-[#9a9a9f]">还没有文件夹</p>
              <p className="mt-1 text-xs text-[#66666b]">先在左侧素材库中创建文件夹</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {rows.map(({ folder, depth, hasChildren }) => {
                const selected = selectedId === folder.id;
                return (
                  <div
                    key={folder.id}
                    className={`flex items-center gap-1 rounded-xl pr-2 transition-colors ${selected ? 'bg-white/[0.09]' : 'hover:bg-white/[0.07]'}`}
                    style={{ paddingLeft: depth * 20 }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleExpanded(folder.id)}
                      disabled={!hasChildren}
                      aria-label={expanded.has(folder.id) ? `收起 ${folder.name}` : `展开 ${folder.name}`}
                      className={`flex h-8 w-6 shrink-0 items-center justify-center rounded-lg text-[#85858a] ${hasChildren ? 'hover:text-white' : 'cursor-default opacity-0'}`}
                    >
                      {expanded.has(folder.id) ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(folder.id);
                        setActionError(null);
                      }}
                      className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left"
                    >
                      <Folder
                        className={`h-4.5 w-4.5 shrink-0 ${selected ? 'text-[#f3f3f0]' : 'text-[#b8b8bd]'}`}
                      />
                      <span
                        className={`truncate text-sm ${selected ? 'font-medium text-white' : 'text-[#dddddf]'}`}
                      >
                        {folder.name}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-white/[0.08] px-4 py-3">
          <span className="min-w-0 truncate text-xs text-red-400">{actionError ?? ''}</span>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 items-center rounded-lg border border-white/[0.12] px-3 text-xs font-medium text-[#dddddf] transition-colors hover:bg-white/[0.07]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => selectedId && save.mutate(selectedId)}
              disabled={!selectedId || save.isPending}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-[#f3f3f0] px-3 text-xs font-medium text-[#151515] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              保存
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
