import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';

export function ConfirmDeleteDialog({ title, description, onConfirm, onClose }: {
  title: string;
  description: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [busy, setBusy] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  const close = () => { if (!busy) ref.current?.close(); };
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try { await onConfirm(); }
    finally { setBusy(false); ref.current?.close(); }
  };
  return (
    <dialog ref={ref} role="alertdialog" aria-labelledby={titleId} aria-describedby={descriptionId} onClose={onClose}
      onCancel={(event) => { event.preventDefault(); close(); }} onKeyDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}
      className="fixed inset-0 m-auto w-[calc(100%-32px)] max-w-[400px] rounded-2xl border border-white/[0.14] bg-[#242424] p-6 text-[#f7f7f2] shadow-2xl backdrop:bg-black/60">
      <h2 id={titleId} className="text-base font-semibold text-white">{title}</h2>
      <p id={descriptionId} className="mt-3 break-words text-sm leading-6 text-[#a4a4a8]">{description}</p>
      <div className="mt-6 flex justify-end gap-3">
        <button autoFocus type="button" onClick={close} disabled={busy} className="h-9 cursor-pointer rounded-lg border border-white/15 px-4 text-sm hover:bg-white/5 disabled:opacity-50">取消</button>
        <button type="button" onClick={() => void confirm()} disabled={busy} className="flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-red-500 px-4 text-sm font-medium text-white hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{busy ? '删除中' : '确认删除'}</button>
      </div>
    </dialog>
  );
}
