import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Folder, Loader2, Upload } from 'lucide-react';
import type { Asset } from '@reel/contracts';
import { api } from '../../../lib/api';
import { useToast } from '../../../components/ui/Toast';
import { AssetLibraryDialog, apiErrorMessage } from './AssetLibraryDialog';

export function EmptyMediaNodeActions({ canvasId, kind, disabled, onFill }: {
  canvasId: string;
  kind: 'image' | 'video';
  disabled?: boolean;
  onFill: (asset: Asset) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();
  const upload = useMutation({
    mutationFn: (file: File) => api.assets.uploadToCanvas(canvasId, kind, file) as Promise<Asset>,
    onSuccess: (asset) => {
      void queryClient.invalidateQueries({ queryKey: ['assetHistory'] });
      onFill(asset);
    },
    onError: (error) => toast.error(apiErrorMessage(error, '上传失败，请重试')),
  });
  const buttonClass = 'flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs text-[#b9b9ba] transition-colors hover:border-white/20 hover:bg-white/[0.12] hover:text-white disabled:cursor-default disabled:opacity-40';
  return <div className="nodrag nopan nowheel flex items-center gap-2" onPointerDown={(event) => event.stopPropagation()}
    onDoubleClick={(event) => event.stopPropagation()} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
    <input ref={input} type="file" accept={kind === 'image' ? 'image/*' : 'video/*'} aria-label={kind === 'image' ? '上传图片文件' : '上传视频文件'} className="hidden" onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || disabled || upload.isPending) return;
      if (!file.type.startsWith(`${kind}/`)) { toast.error(kind === 'image' ? '请选择图片文件' : '请选择视频文件'); return; }
      if (file.size > 1024 * 1024 * 1024) { toast.error('文件大小不能超过 1GB'); return; }
      upload.mutate(file);
    }} />
    <button type="button" disabled={disabled || upload.isPending} onClick={() => input.current?.click()} className={buttonClass}>
      {upload.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{upload.isPending ? '上传中' : '上传'}
    </button>
    <button type="button" disabled={disabled || upload.isPending} onClick={() => setLibraryOpen(true)} className={buttonClass}><Folder className="h-3.5 w-3.5" />资产库</button>
    {libraryOpen && createPortal(<div className="nodrag nopan nowheel fixed inset-0 z-[1000]" onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
      <AssetLibraryDialog assetKind={kind} onClose={() => setLibraryOpen(false)} onToast={toast.show} onAddToCanvas={onFill} />
    </div>, document.body)}
  </div>;
}
