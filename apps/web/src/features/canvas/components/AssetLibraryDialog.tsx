import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Asset,
  AssetFolder,
  AssetFolderScope,
  AssetLibrarySearchResult,
} from '@reel/contracts';
import {
  AudioLines,
  Check,
  ChevronRight,
  Download,
  Film,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { ApiError, api } from '../../../lib/api';

const SCOPE_TABS: { value: AssetFolderScope; label: string }[] = [
  { value: 'personal', label: '个人' },
  { value: 'team', label: '团队' },
];

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    try {
      const parsed = JSON.parse(error.body) as { message?: unknown };
      if (typeof parsed.message === 'string' && parsed.message) return parsed.message;
      if (Array.isArray(parsed.message)) return parsed.message.filter(Boolean).join('；');
    } catch {
      // 响应体不是 JSON 时使用兜底文案
    }
  }
  return fallback;
}

function formatFolderDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getMonth() + 1}月${date.getDate()}日创建`;
}

function urlExtension(url: string): string {
  try {
    const pathname = new URL(url, window.location.origin).pathname;
    const dot = pathname.lastIndexOf('.');
    return dot >= 0 ? pathname.slice(dot) : '';
  } catch {
    return '';
  }
}

// fetch → blob 下载，保证跨域绝对地址也能落盘为文件
async function downloadAssetFile(asset: Asset): Promise<void> {
  // 文本素材没有 url，直接把内容打包成 .txt
  if (asset.kind === 'text') {
    if (!asset.content) return;
    const blob = new Blob([asset.content], { type: 'text/plain;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `${asset.name}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    return;
  }
  if (!asset.url) return;
  const res = await fetch(asset.url, { credentials: 'include' });
  if (!res.ok) throw new Error(`下载失败：${res.status}`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  const ext = urlExtension(asset.url);
  link.download = /\.[a-zA-Z0-9]+$/.test(asset.name) ? asset.name : `${asset.name}${ext}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

interface LibraryAssetThumbProps {
  asset: Asset;
  renaming?: boolean;
  renameValue?: string;
  onRenameValueChange?: (value: string) => void;
  onCommitRename?: () => void;
  onCancelRename?: () => void;
  onAdd: () => void;
  onOpenMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

function LibraryAssetThumb({
  asset,
  renaming = false,
  renameValue = '',
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onAdd,
  onOpenMenu,
}: LibraryAssetThumbProps) {
  const Icon = asset.kind === 'audio' ? AudioLines : asset.kind === 'image' ? ImageIcon : Film;
  return (
    <div
      className="group relative"
      title={`添加 ${asset.name} 到画布`}
    >
      <button
        type="button"
        onClick={onAdd}
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
        ) : asset.kind === 'text' ? (
          <span className="block h-full w-full overflow-hidden px-2 py-1.5 text-left text-[10px] leading-4 text-[#b8b8bd] line-clamp-4">
            {asset.content || '（空文本）'}
          </span>
        ) : (
          <div className="flex flex-col items-center gap-1 text-[#9a9a9f]">
            <Icon className="h-[22px] w-[22px]" />
          </div>
        )}
        {renaming ? null : (
          <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1.5 py-0.5 text-left text-[10px] text-white">
            {asset.name}
          </span>
        )}
      </button>
      {renaming ? (
        <input
          autoFocus
          value={renameValue}
          onChange={(event) => onRenameValueChange?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onCommitRename?.();
            }
            if (event.key === 'Escape') {
              event.stopPropagation();
              onCancelRename?.();
            }
          }}
          onBlur={onCommitRename}
          maxLength={200}
          aria-label="素材名称"
          className="absolute inset-x-0 bottom-0 rounded-b-lg bg-black/80 px-1.5 py-0.5 text-[10px] text-white outline-none ring-1 ring-[#f3f3f0]/60"
        />
      ) : null}
      {onOpenMenu && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpenMenu(event);
          }}
          aria-label={`${asset.name} 的更多操作`}
          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-black/70 text-white opacity-0 transition-opacity hover:bg-black/90 focus:opacity-100 group-hover:opacity-100"
        >
          <MoreVertical className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

interface FolderRowProps {
  folder: AssetFolder;
  renaming: boolean;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onOpen: () => void;
  onOpenMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

function FolderRow({
  folder,
  renaming,
  renameValue,
  onRenameValueChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onOpen,
  onOpenMenu,
}: FolderRowProps) {
  return (
    <div className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.07]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] text-[#b8b8bd]">
        <Folder className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(event) => onRenameValueChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onCommitRename();
              }
              if (event.key === 'Escape') {
                event.stopPropagation();
                onCancelRename();
              }
            }}
            onBlur={onCommitRename}
            maxLength={100}
            aria-label="文件夹名称"
            className="w-full rounded-lg border border-white/[0.12] bg-black/20 px-2.5 py-1.5 text-sm font-medium text-white outline-none focus:border-white/[0.24]"
          />
        ) : (
          <button type="button" onClick={onOpen} className="block w-full text-left">
            <span className="block truncate text-sm font-medium text-[#eeeeef]">{folder.name}</span>
            <span className="mt-1 block text-xs text-[#77777c]">
              {formatFolderDate(folder.createdAt)}
            </span>
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label={`${folder.name} 的更多操作`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#85858a] opacity-0 transition-opacity hover:bg-white/[0.07] hover:text-white focus:opacity-100 group-hover:opacity-100"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
    </div>
  );
}

export function AssetLibraryDialog({
  onClose,
  onToast,
  onAddToCanvas,
}: {
  onClose: () => void;
  onToast: (message: string) => void;
  /** 点击素材时把素材作为新节点添加到画布 */
  onAddToCanvas: (asset: Asset) => void;
}) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<AssetFolderScope>('personal');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [menuFolder, setMenuFolder] = useState<{
    folder: AssetFolder;
    x: number;
    y: number;
  } | null>(null);
  const [menuAsset, setMenuAsset] = useState<{ asset: Asset; x: number; y: number } | null>(null);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [renamingAssetId, setRenamingAssetId] = useState<string | null>(null);
  const [assetRenameValue, setAssetRenameValue] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const menuFolderRef = useRef(menuFolder);
  menuFolderRef.current = menuFolder;
  const menuAssetRef = useRef(menuAsset);
  menuAssetRef.current = menuAsset;
  const previewAssetRef = useRef(previewAsset);
  previewAssetRef.current = previewAsset;

  const foldersQuery = useQuery<AssetFolder[]>({
    queryKey: ['assetFolders', scope],
    queryFn: () => api.assetFolders.list(scope) as Promise<AssetFolder[]>,
  });
  const folders = foldersQuery.data ?? [];

  const folderAssetsQuery = useQuery<Asset[]>({
    queryKey: ['assetFolders', scope, 'assets', currentFolderId],
    queryFn: () => api.assetFolders.listAssets(currentFolderId!) as Promise<Asset[]>,
    enabled: currentFolderId !== null,
  });

  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);

  // 从当前文件夹向上回溯出面包屑链
  const breadcrumb = useMemo(() => {
    const chain: AssetFolder[] = [];
    let cursor = currentFolderId ? folderMap.get(currentFolderId) : undefined;
    while (cursor) {
      chain.unshift(cursor);
      cursor = cursor.parentId ? folderMap.get(cursor.parentId) : undefined;
    }
    return chain;
  }, [currentFolderId, folderMap]);

  const childFolders = useMemo(
    () => folders.filter((folder) => (folder.parentId ?? null) === currentFolderId),
    [folders, currentFolderId],
  );
  const folderAssets = currentFolderId === null ? [] : (folderAssetsQuery.data ?? []);

  const searching = scope === 'personal' && debouncedSearch.length > 0;
  const searchQuery = useQuery<AssetLibrarySearchResult[]>({
    queryKey: ['assetFolders', scope, 'search', debouncedSearch],
    queryFn: () =>
      api.assetFolders.searchAssets(debouncedSearch) as Promise<AssetLibrarySearchResult[]>,
    enabled: searching,
  });
  const searchResults = searching ? (searchQuery.data ?? []) : [];

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  // 进入搜索模式时收起进行中的编辑状态
  useEffect(() => {
    if (debouncedSearch.length > 0) {
      setCreating(false);
      setRenamingId(null);
      setRenamingAssetId(null);
      setMenuFolder(null);
      setMenuAsset(null);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (previewAssetRef.current) {
        setPreviewAsset(null);
        return;
      }
      if (menuFolderRef.current || menuAssetRef.current) {
        setMenuFolder(null);
        setMenuAsset(null);
        return;
      }
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const invalidateFolders = () => {
    void queryClient.invalidateQueries({ queryKey: ['assetFolders', scope] });
  };

  const createFolder = useMutation({
    mutationFn: (name: string) =>
      api.assetFolders.create({
        name,
        scope,
        ...(currentFolderId ? { parentId: currentFolderId } : {}),
      }) as Promise<AssetFolder>,
    onSuccess: () => {
      setCreating(false);
      setNewFolderName('');
      setActionError(null);
      invalidateFolders();
    },
    onError: (error) => setActionError(apiErrorMessage(error, '创建文件夹失败，请稍后重试')),
  });

  const renameFolder = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.assetFolders.rename(id, name) as Promise<AssetFolder>,
    onSuccess: () => {
      setRenamingId(null);
      setActionError(null);
      invalidateFolders();
    },
    onError: (error) => setActionError(apiErrorMessage(error, '重命名失败，请稍后重试')),
  });

  const deleteFolder = useMutation({
    mutationFn: (id: string) => api.assetFolders.remove(id),
    onSuccess: () => {
      setMenuFolder(null);
      setActionError(null);
      invalidateFolderAssets();
    },
    onError: (error) => setActionError(apiErrorMessage(error, '删除文件夹失败，请稍后重试')),
  });

  // 素材/搜索/文件夹列表同属一个前缀，统一失效保证搜索结果与文件夹视图同步
  const invalidateFolderAssets = () => {
    void queryClient.invalidateQueries({ queryKey: ['assetFolders', scope] });
  };

  const renameAsset = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.assets.rename(id, name) as Promise<Asset>,
    onSuccess: () => {
      setRenamingAssetId(null);
      setActionError(null);
      invalidateFolderAssets();
    },
    onError: (error) => setActionError(apiErrorMessage(error, '重命名失败，请稍后重试')),
  });

  const deleteAsset = useMutation({
    mutationFn: (id: string) => api.assets.remove(id),
    onSuccess: () => {
      setMenuAsset(null);
      setActionError(null);
      invalidateFolderAssets();
    },
    onError: (error) => setActionError(apiErrorMessage(error, '删除素材失败，请稍后重试')),
  });

  const switchScope = (next: AssetFolderScope) => {
    if (next === scope) return;
    setScope(next);
    setCurrentFolderId(null);
    setCreating(false);
    setNewFolderName('');
    setRenamingId(null);
    setRenamingAssetId(null);
    setMenuAsset(null);
    setPreviewAsset(null);
    setSearch('');
    setDebouncedSearch('');
    setActionError(null);
  };

  const startRename = (folder: AssetFolder) => {
    setMenuFolder(null);
    setCreating(false);
    setRenamingId(folder.id);
    setRenameValue(folder.name);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const folder = folders.find((item) => item.id === renamingId);
    const name = renameValue.trim();
    if (!folder || !name || name === folder.name) {
      setRenamingId(null);
      return;
    }
    renameFolder.mutate({ id: folder.id, name });
  };

  const submitCreate = () => {
    const name = newFolderName.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    createFolder.mutate(name);
  };

  const openCreating = () => {
    setRenamingId(null);
    setCreating(true);
    setNewFolderName('');
  };

  const downloadFolder = async (folder: AssetFolder) => {
    setMenuFolder(null);
    setDownloading(true);
    try {
      const assets = (await api.assetFolders.listAssets(folder.id)) as Asset[];
      const ready = assets.filter((asset) => asset.status === 'ready' && asset.url);
      if (ready.length === 0) {
        onToast('暂无素材内容可供下载');
        return;
      }
      for (const asset of ready) {
        await downloadAssetFile(asset);
      }
      onToast(`已开始下载 ${ready.length} 个素材`);
    } catch {
      onToast('下载失败，请稍后重试');
    } finally {
      setDownloading(false);
    }
  };

  const openMenu = (folder: AssetFolder, event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuFolder({ folder, x: rect.right, y: rect.bottom });
  };

  const openAssetMenu = (asset: Asset, event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuAsset({ asset, x: rect.right, y: rect.bottom });
  };

  const startAssetRename = (asset: Asset) => {
    setMenuAsset(null);
    setRenamingAssetId(asset.id);
    setAssetRenameValue(asset.name);
  };

  const commitAssetRename = () => {
    if (!renamingAssetId) return;
    const asset =
      folderAssets.find((item) => item.id === renamingAssetId) ??
      searchResults.find((item) => item.id === renamingAssetId);
    const name = assetRenameValue.trim();
    if (!asset || !name || name === asset.name) {
      setRenamingAssetId(null);
      return;
    }
    renameAsset.mutate({ id: asset.id, name });
  };

  const downloadSingleAsset = async (asset: Asset) => {
    setMenuAsset(null);
    setDownloading(true);
    try {
      await downloadAssetFile(asset);
      onToast('已开始下载素材');
    } catch {
      onToast('下载失败，请稍后重试');
    } finally {
      setDownloading(false);
    }
  };

  const addAssetToCanvas = (asset: Asset) => {
    if (asset.status !== 'ready') return;
    if (asset.kind !== 'image' && asset.kind !== 'video' && asset.kind !== 'text') return;
    onAddToCanvas(asset);
    onClose();
  };

  const renderFolderRows = () => (
    <div className="space-y-1">
      {creating && (
        <div className="flex items-center gap-3 rounded-xl bg-white/[0.05] px-3 py-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] text-[#b8b8bd]">
            <Folder className="h-4.5 w-4.5" />
          </span>
          <input
            autoFocus
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setCreating(false);
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                submitCreate();
              }
            }}
            maxLength={100}
            placeholder="输入文件夹名称"
            aria-label="新文件夹名称"
            className="min-w-0 flex-1 rounded-lg border border-white/[0.12] bg-black/20 px-2.5 py-1.5 text-sm text-white outline-none placeholder:text-[#77777c] focus:border-white/[0.24]"
          />
          <button
            type="button"
            onClick={submitCreate}
            disabled={createFolder.isPending}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[#85858a] hover:bg-white/[0.07] hover:text-white disabled:opacity-40"
            aria-label="确认创建"
          >
            {createFolder.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[#85858a] hover:bg-white/[0.07] hover:text-white"
            aria-label="取消创建"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {childFolders.map((folder) => (
        <FolderRow
          key={folder.id}
          folder={folder}
          renaming={renamingId === folder.id}
          renameValue={renameValue}
          onRenameValueChange={setRenameValue}
          onStartRename={() => startRename(folder)}
          onCommitRename={commitRename}
          onCancelRename={() => setRenamingId(null)}
          onOpen={() => setCurrentFolderId(folder.id)}
          onOpenMenu={(event) => openMenu(folder, event)}
        />
      ))}
    </div>
  );

  const folderMenuPosition = menuFolder
    ? {
        left: Math.max(8, menuFolder.x - 148),
        top: Math.min(menuFolder.y + 4, window.innerHeight - 200),
      }
    : undefined;

  const assetMenuPosition = menuAsset
    ? {
        left: Math.max(8, Math.min(menuAsset.x - 148, window.innerWidth - 160)),
        top: Math.min(menuAsset.y + 4, window.innerHeight - 200),
      }
    : undefined;

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/35 px-5 backdrop-blur-[2px]"
      onPointerDown={() => {
        // 关闭前先提交进行中的重命名，避免卸载输入框导致 blur 保存丢失
        commitRename();
        commitAssetRename();
        onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="素材库"
        className="nodrag nopan nowheel flex max-h-[72vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-white/[0.14] bg-[#242424] shadow-[0_28px_80px_rgba(0,0,0,0.62)]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-white/[0.08] p-4 pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1" aria-label="素材库范围切换">
              {SCOPE_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => switchScope(tab.value)}
                  className={`h-8 rounded-lg px-3 text-xs font-medium transition-colors ${scope === tab.value ? 'bg-[#f3f3f0] text-[#151515]' : 'text-[#a4a4a8] hover:bg-white/[0.07] hover:text-white'}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={openCreating}
              disabled={scope === 'team'}
              title={scope === 'team' ? '团队功能上线后开放' : undefined}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.12] bg-white/[0.055] px-3 text-xs font-medium text-[#e1e1e3] transition-colors hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              新建文件夹
            </button>
          </div>
          <div className="mt-3 flex h-9 items-center gap-2 rounded-xl border border-white/[0.12] bg-white/[0.055] px-3 transition-colors focus-within:border-white/[0.24]">
            <Search className="h-4 w-4 shrink-0 text-[#85858a]" />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索素材名称"
              aria-label="搜索素材名称"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#77777c]"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  searchInputRef.current?.focus();
                }}
                className="flex h-6 w-6 items-center justify-center rounded-lg text-[#85858a] hover:bg-white/[0.07] hover:text-white"
                aria-label="清空素材搜索"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {currentFolderId !== null && (
            <nav
              aria-label="文件夹路径"
              className="mt-3 flex min-w-0 items-center gap-0.5 text-xs"
            >
              <button
                type="button"
                onClick={() => setCurrentFolderId(null)}
                className="rounded-md px-1.5 py-1 text-[#a4a4a8] transition-colors hover:bg-white/[0.07] hover:text-white"
              >
                素材库
              </button>
              {breadcrumb.map((folder) => (
                <span key={folder.id} className="flex min-w-0 items-center gap-0.5">
                  <ChevronRight className="h-3 w-3 shrink-0 text-[#66666b]" />
                  <button
                    type="button"
                    onClick={() => setCurrentFolderId(folder.id)}
                    className={`truncate rounded-md px-1.5 py-1 transition-colors hover:bg-white/[0.07] ${folder.id === currentFolderId ? 'text-[#eeeeef]' : 'text-[#a4a4a8] hover:text-white'}`}
                  >
                    {folder.name}
                  </button>
                </span>
              ))}
            </nav>
          )}
        </div>

        <div className="reel-scroll min-h-40 flex-1 overflow-y-auto p-2">
          {foldersQuery.isLoading ? (
            <div className="flex min-h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-[#77777c]" />
            </div>
          ) : searching ? (
            searchQuery.isLoading ? (
              <div className="flex min-h-40 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-[#77777c]" />
              </div>
            ) : searchResults.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {searchResults.map((result) => (
                  <div key={result.id} className="flex min-w-0 flex-col">
                    <LibraryAssetThumb
                      asset={result}
                      renaming={renamingAssetId === result.id}
                      renameValue={assetRenameValue}
                      onRenameValueChange={setAssetRenameValue}
                      onCommitRename={commitAssetRename}
                      onCancelRename={() => setRenamingAssetId(null)}
                      onAdd={() => addAssetToCanvas(result)}
                      onOpenMenu={(event) => openAssetMenu(result, event)}
                    />
                    <span
                      className="mt-1 truncate px-0.5 text-[10px] text-[#77777c]"
                      title={result.folderPath.map((folder) => folder.name).join(' / ')}
                    >
                      {result.folderPath.map((folder) => folder.name).join(' / ') || '素材库根目录'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-40 flex-col items-center justify-center text-center">
                <Search className="h-6 w-6 text-[#55555a]" />
                <p className="mt-3 text-sm text-[#9a9a9f]">没有找到匹配的素材</p>
                <p className="mt-1 text-xs text-[#66666b]">试试其他关键词</p>
              </div>
            )
          ) : currentFolderId === null && folders.length === 0 && !creating ? (
            <div className="flex min-h-40 flex-col items-center justify-center text-center">
              {scope === 'personal' ? (
                <>
                  <FolderPlus className="h-6 w-6 text-[#55555a]" />
                  <p className="mt-3 text-sm text-[#9a9a9f]">还没有文件夹</p>
                  <p className="mt-1 text-xs text-[#66666b]">点击上方「新建文件夹」创建第一个</p>
                </>
              ) : (
                <>
                  <Users className="h-6 w-6 text-[#55555a]" />
                  <p className="mt-3 text-sm text-[#9a9a9f]">团队素材库暂无文件夹</p>
                  <p className="mt-1 text-xs text-[#66666b]">
                    团队功能上线后，这里将展示团队共享的素材文件夹
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {renderFolderRows()}
              {currentFolderId !== null &&
                (folderAssetsQuery.isLoading ? (
                  <div className="flex min-h-24 items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-[#77777c]" />
                  </div>
                ) : folderAssets.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {folderAssets.map((asset) => (
                      <LibraryAssetThumb
                        key={asset.id}
                        asset={asset}
                        renaming={renamingAssetId === asset.id}
                        renameValue={assetRenameValue}
                        onRenameValueChange={setAssetRenameValue}
                        onCommitRename={commitAssetRename}
                        onCancelRename={() => setRenamingAssetId(null)}
                        onAdd={() => addAssetToCanvas(asset)}
                        onOpenMenu={(event) => openAssetMenu(asset, event)}
                      />
                    ))}
                  </div>
                ) : childFolders.length === 0 && !creating ? (
                  <div className="flex min-h-40 flex-col items-center justify-center text-center">
                    <Film className="h-6 w-6 text-[#55555a]" />
                    <p className="mt-3 text-sm text-[#9a9a9f]">该文件夹暂无素材</p>
                    <p className="mt-1 text-xs text-[#66666b]">
                      在画布中右键素材节点，可保存到该文件夹
                    </p>
                  </div>
                ) : null)}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/[0.08] px-4 py-2.5 text-xs">
          {actionError ? (
            <span className="text-red-400">{actionError}</span>
          ) : searching ? (
            <span className="text-[#66666b]">共 {searchResults.length} 个素材</span>
          ) : currentFolderId === null ? (
            <span className="text-[#66666b]">共 {folders.length} 个文件夹</span>
          ) : (
            <span className="text-[#66666b]">
              共 {childFolders.length} 个子文件夹 · {folderAssets.length} 个素材
            </span>
          )}
        </div>
      </section>

      {menuFolder && folderMenuPosition && (
        <>
          <div
            className="fixed inset-0 z-50"
            onPointerDown={(event) => {
              event.stopPropagation();
              setMenuFolder(null);
            }}
          />
          <div
            role="menu"
            aria-label={`${menuFolder.folder.name} 的操作`}
            className="fixed z-50 w-36 overflow-hidden rounded-xl border border-white/[0.13] bg-[#292929] p-1.5 shadow-[0_16px_42px_rgba(0,0,0,0.52)]"
            style={folderMenuPosition}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const { folder } = menuFolder;
                setMenuFolder(null);
                setCurrentFolderId(folder.id);
                openCreating();
              }}
              className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-[#dddddf] transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <FolderPlus className="h-4 w-4" />
              新建文件夹
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => startRename(menuFolder.folder)}
              className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-[#dddddf] transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <Pencil className="h-4 w-4" />
              重命名
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => void downloadFolder(menuFolder.folder)}
              disabled={downloading}
              className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-[#dddddf] transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              下载
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => deleteFolder.mutate(menuFolder.folder.id)}
              disabled={deleteFolder.isPending}
              className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-[#ef9b9b] transition-colors hover:bg-red-500/[0.12] hover:text-red-300 disabled:opacity-40"
            >
              {deleteFolder.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              删除
            </button>
          </div>
        </>
      )}

      {menuAsset && assetMenuPosition && (
        <>
          <div
            className="fixed inset-0 z-50"
            onPointerDown={(event) => {
              event.stopPropagation();
              setMenuAsset(null);
            }}
          />
          <div
            role="menu"
            aria-label={`${menuAsset.asset.name} 的操作`}
            className="fixed z-50 w-36 overflow-hidden rounded-xl border border-white/[0.13] bg-[#292929] p-1.5 shadow-[0_16px_42px_rgba(0,0,0,0.52)]"
            style={assetMenuPosition}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setPreviewAsset(menuAsset.asset);
                setMenuAsset(null);
              }}
              className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-[#dddddf] transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <Maximize2 className="h-4 w-4" />
              预览
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => startAssetRename(menuAsset.asset)}
              className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-[#dddddf] transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <Pencil className="h-4 w-4" />
              重命名
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => void downloadSingleAsset(menuAsset.asset)}
              disabled={downloading}
              className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-[#dddddf] transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              下载
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => deleteAsset.mutate(menuAsset.asset.id)}
              disabled={deleteAsset.isPending}
              className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-[#ef9b9b] transition-colors hover:bg-red-500/[0.12] hover:text-red-300 disabled:opacity-40"
            >
              {deleteAsset.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              删除
            </button>
          </div>
        </>
      )}

      {previewAsset && (
        <div
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-black/85 p-6"
          onPointerDown={(event) => {
            event.stopPropagation();
            setPreviewAsset(null);
          }}
        >
          <button
            type="button"
            onClick={() => setPreviewAsset(null)}
            aria-label="关闭预览"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
          {previewAsset.kind === 'image' && previewAsset.url ? (
            <img
              src={previewAsset.url}
              alt={previewAsset.name}
              draggable={false}
              className="max-h-[78vh] max-w-[86vw] object-contain"
            />
          ) : previewAsset.kind === 'video' && previewAsset.url ? (
            <video
              src={previewAsset.url}
              controls
              autoPlay
              className="max-h-[78vh] max-w-[86vw]"
              onPointerDown={(event) => event.stopPropagation()}
            />
          ) : previewAsset.kind === 'text' ? (
            <div
              className="reel-scroll max-h-[70vh] max-w-[80vw] overflow-y-auto whitespace-pre-wrap rounded-xl bg-white/[0.04] p-5 text-sm leading-6 text-[#e1e1e3]"
              onPointerDown={(event) => event.stopPropagation()}
            >
              {previewAsset.content}
            </div>
          ) : previewAsset.kind === 'audio' && previewAsset.url ? (
            <audio
              src={previewAsset.url}
              controls
              autoPlay
              onPointerDown={(event) => event.stopPropagation()}
            />
          ) : (
            <p className="text-sm text-[#9a9a9f]">该素材暂无可预览的内容</p>
          )}
          <p
            className="mt-4 max-w-[86vw] truncate text-sm text-white/80"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {previewAsset.name}
          </p>
        </div>
      )}
    </div>
  );
}
