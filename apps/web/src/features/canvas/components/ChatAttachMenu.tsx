import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Loader2, Plus, Upload } from 'lucide-react';
import { api } from '../../../lib/api';
import type { CanvasChatReference } from '../chat-types';
import { ChatAssetPickerModal } from './ChatAssetPickerModal';

/**
 * 聊天输入框的「+」附件按钮：上传图片（当前仅支持图片）或打开素材选择弹窗。
 * 上传统一归到画布作用域（canvasId 必传）；首页尚无画布时先以本地预览插入，
 * 由父组件在创建画布后再上传（onPick 会带回 File）。
 */
export function ChatAttachMenu({ canvasId, uploads, draftIds, onPick, onUploaded, onConfirmPicks, disabled = false }: {
  canvasId?: string;
  /** 我上传的 tab 数据：本次会话通过上传动作产生的素材 */
  uploads?: CanvasChatReference[];
  /** 已在输入框中的引用 id（弹窗内标记为已添加） */
  draftIds?: ReadonlySet<string>;
  onPick: (reference: CanvasChatReference, file?: File) => void;
  onUploaded?: (reference: CanvasChatReference, file?: File) => void;
  /** 弹窗确认：批量加入输入框 */
  onConfirmPicks: (references: CanvasChatReference[]) => void;
  disabled?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  async function handleUpload(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('目前仅支持图片');
      return;
    }
    setUploading(true);
    setError('');
    try {
      if (canvasId) {
        const asset = await api.assets.uploadToCanvas(canvasId, 'image', file) as { id: string; name: string; url: string | null };
        const reference: CanvasChatReference = { id: asset.id, kind: 'image', title: asset.name, assetId: asset.id, url: asset.url ?? undefined };
        onUploaded?.(reference);
        onPick(reference);
        setMenuOpen(false);
      } else {
        // 首页：先以本地预览插入，提交创建画布后由父组件上传
        const reference: CanvasChatReference = { id: `local-${crypto.randomUUID()}`, kind: 'image', title: file.name, url: URL.createObjectURL(file) };
        onUploaded?.(reference, file);
        onPick(reference, file);
        setMenuOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败，请重试');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="添加素材"
        title="上传图片或添加素材"
        disabled={disabled || uploading}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => { setError(''); setMenuOpen(!menuOpen); }}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.12] text-[#b9b9ba] transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
      </button>
      {menuOpen && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-52 rounded-xl border border-white/[0.15] bg-[#282828] p-1.5 shadow-2xl">
          <button type="button" className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-[#dededb] transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={uploading}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => fileInput.current?.click()}>
            <Upload className="h-4 w-4 shrink-0 text-[#9a9a9f]" />
            <span>上传</span>
          </button>
          <button type="button" className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-[#dededb] transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={uploading}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { setMenuOpen(false); setPickerOpen(true); }}>
            <FolderOpen className="h-4 w-4 shrink-0 text-[#9a9a9f]" />
            <span>添加</span>
          </button>
        </div>
      )}
      {error && <p role="alert" className="absolute bottom-full left-0 z-50 mb-1 whitespace-nowrap text-xs text-[#efa1a8]">{error}</p>}
      {pickerOpen && (
        <ChatAssetPickerModal
          open
          uploads={uploads ?? []}
          draftIds={draftIds ?? new Set()}
          onClose={() => setPickerOpen(false)}
          onConfirm={(references) => { onConfirmPicks(references); setPickerOpen(false); }}
        />
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void handleUpload(file);
        }}
      />
    </div>
  );
}
