import { useEffect, useRef, useState } from 'react';
import type { Asset } from '@reel/contracts';
import { AlignLeft, AudioLines, Download, Film, Image as ImageIcon, Loader2, Trash2, X } from 'lucide-react';
import { downloadAssetFile } from '../../../lib/download-asset';
import { MaterialReferenceChip } from './MaterialReferenceChip';
import { materialGenerationInfo } from './material-generation-info';

const KIND_LABELS = { image: '图片', video: '视频', audio: '音频', text: '文本' };

function aspectRatio(width: number, height: number): string {
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

export function MaterialDetailDialog({ asset, creatorName, onClose, onDelete }: {
  asset: Asset;
  creatorName?: string;
  onClose: () => void;
  onDelete?: (asset: Asset) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const generationInfo = materialGenerationInfo(asset);
  const Icon = { image: ImageIcon, video: Film, audio: AudioLines, text: AlignLeft }[asset.kind];
  const tags = [
    asset.model || '模型未记录',
    ...(asset.kind === 'image' || asset.kind === 'video' ? [
      asset.width && asset.height ? aspectRatio(asset.width, asset.height) : '比例未记录',
      asset.width && asset.height ? `${asset.width} × ${asset.height}` : '清晰度未记录',
    ] : []),
  ];

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const close = () => dialogRef.current?.close();

  const download = async () => {
    setError('');
    setDownloading(true);
    try { await downloadAssetFile(asset); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '下载失败，请重试'); }
    finally { setDownloading(false); }
  };

  const deleteAsset = async () => {
    if (!onDelete || deleting) return;
    setError('');
    setDeleting(true);
    try {
      await onDelete(asset);
      close();
    } catch {
      setError('删除素材失败，请稍后重试');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <dialog ref={dialogRef} aria-label="素材详情" onCancel={(event) => { event.preventDefault(); close(); }} onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-32px)] max-w-[1120px] overflow-hidden rounded-2xl border border-white/[0.12] bg-[#191919] p-0 text-[#f7f7f2] shadow-[0_32px_120px_rgba(0,0,0,0.7)] backdrop:bg-black/75 backdrop:backdrop-blur-sm">
      <div className="relative flex max-h-[90dvh] flex-col md:h-[min(720px,85dvh)] md:flex-row">
        <button type="button" onClick={close} aria-label="关闭素材详情" className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-[#aaaab0] hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
        <div className="flex h-[35dvh] min-h-0 min-w-0 items-center justify-center overflow-hidden bg-[#101010] p-6 md:h-auto md:flex-1 md:p-8">
          {asset.kind === 'image' && asset.url ? (
            <img src={asset.url} alt={asset.name} className="h-full w-full object-contain" />
          ) : asset.kind === 'video' && asset.url ? (
            <video src={asset.url} controls preload="metadata" className="h-full w-full object-contain" aria-label={asset.name} />
          ) : asset.kind === 'audio' && asset.url ? (
            <div className="flex w-full max-w-md flex-col items-center gap-8"><AudioLines className="h-20 w-20 text-[#77777c]" /><audio src={asset.url} controls className="w-full" aria-label={asset.name} /></div>
          ) : asset.kind === 'text' ? (
            <div className="reel-scroll h-full w-full overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7 text-[#dedee0]">{asset.content || '暂无文本内容'}</div>
          ) : <Icon className="h-20 w-20 text-[#77777c]" />}
        </div>
        <aside className="flex min-h-0 flex-col border-t border-white/[0.08] md:w-[340px] md:shrink-0 md:border-l md:border-t-0">
          <div className="reel-scroll min-h-0 flex-1 space-y-7 overflow-y-auto px-7 pb-8 pt-8 md:pt-12">
            <h2 className="text-xl font-semibold">{KIND_LABELS[asset.kind]}</h2>
            <dl className="space-y-5 text-sm">
              <div className="flex items-baseline gap-4"><dt className="w-16 shrink-0 text-xs text-[#77777c]">创作者</dt><dd className="min-w-0 break-words">{creatorName || '未知创作者'}</dd></div>
              <div className="flex items-baseline gap-4"><dt className="w-16 shrink-0 text-xs text-[#77777c]">创建时间</dt><dd className="min-w-0">{new Date(asset.createdAt).toLocaleString('zh-CN', { hour12: false })}</dd></div>
              <div>
                <dt className="mb-3 text-xs text-[#77777c]">生成信息</dt>
                <dd>
                  <p className="whitespace-pre-wrap break-words leading-6 text-[#c4c4c8]">{generationInfo.prompt || '未记录提示词'}</p>
                  <div className="mt-4 flex flex-wrap gap-2" aria-label="生成参数">
                    {tags.map((tag, index) => <span key={index} className="rounded-md border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-xs text-[#b9b9bf]">{tag}</span>)}
                  </div>
                </dd>
              </div>
              <div><dt className="mb-3 text-xs text-[#77777c]">参考内容</dt><dd className="flex flex-wrap gap-2">{generationInfo.references.length ? generationInfo.references.map((reference, index) => <MaterialReferenceChip key={index} reference={reference} />) : <span className="text-[#77777c]">暂无参考内容</span>}</dd></div>
            </dl>
          </div>
          <div className="shrink-0 p-6">
            {error && <p role="alert" className="mb-3 text-xs text-red-400">{error}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={() => void deleteAsset()} disabled={deleting || downloading} aria-disabled={!onDelete || deleting || downloading} title={onDelete ? undefined : '暂未开放'} className={`flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-white/[0.12] text-sm disabled:cursor-not-allowed disabled:opacity-50 ${onDelete ? 'text-[#ef9b9b] hover:border-red-400/30 hover:bg-red-500/10' : 'text-[#8e8e92]'}`}>{deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{deleting ? '删除中' : '删除'}</button>
              <button type="button" onClick={() => void download()} disabled={deleting || downloading || (asset.kind !== 'text' && !asset.url)} className="flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#f7f7f2] text-sm font-medium text-[#151515] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50">{downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{downloading ? '下载中' : '下载'}</button>
            </div>
          </div>
        </aside>
      </div>
    </dialog>
  );
}
