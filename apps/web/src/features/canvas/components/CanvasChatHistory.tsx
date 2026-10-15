import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { ConversationSummary } from '../chat-types';
import type { useCanvasChat } from '../useCanvasChat';

export function CanvasChatHistory({ chat }: { chat: ReturnType<typeof useCanvasChat> }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null);

  function startEditing(item: ConversationSummary) {
    setEditingId(item.id);
    setEditTitle(item.title);
  }

  async function saveTitle() {
    if (editingId && await chat.renameConversation(editingId, editTitle)) setEditingId(null);
  }

  async function confirmDelete() {
    if (deleteTarget && await chat.deleteConversation(deleteTarget.id)) setDeleteTarget(null);
  }

  return (
    <div className="relative min-w-0 flex-1">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="选择对话" className="flex max-w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-semibold text-[#f3f3f0] hover:bg-white/[0.08]">
        <span className="truncate">{chat.title}</span><ChevronDown className="h-4 w-4 shrink-0 text-[#99999d]" />
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-50 w-[min(340px,calc(86vw-32px))] overflow-hidden rounded-xl border border-white/[0.14] bg-[#242424] shadow-2xl">
          <div className="reel-scroll flex max-h-72 flex-col gap-1 overflow-y-auto p-1.5">
            {chat.list.isLoading && <p className="px-3 py-2 text-xs text-[#929296]">加载中...</p>}
            {!chat.list.isLoading && !chat.list.data?.length && <p className="px-3 py-2 text-xs text-[#929296]">暂无历史对话</p>}
            {chat.list.data?.map((item) => (
              <div key={item.id} className={`group flex min-h-10 w-full cursor-pointer items-center gap-1 rounded-lg pr-1 transition-colors hover:bg-white/[0.08] ${item.id === chat.activeId ? 'bg-white/[0.08] text-white' : 'text-[#c5c5c7]'}`}>
                {editingId === item.id ? (
                  <form className="flex min-w-0 flex-1 px-2" onSubmit={(event) => { event.preventDefault(); void saveTitle(); }}>
                    <input autoFocus aria-label="对话名称" value={editTitle} onChange={(event) => setEditTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setEditingId(null); }} maxLength={80} disabled={chat.busy} className="h-8 w-full min-w-0 rounded border border-white/25 bg-[#1b1b1b] px-2 text-sm text-white outline-none focus:border-white/50" />
                  </form>
                ) : (
                  <button type="button" disabled={chat.busy} onClick={() => { chat.selectConversation(item.id); setOpen(false); }} className="min-w-0 flex-1 cursor-pointer truncate px-3 py-2 text-left text-sm disabled:cursor-default disabled:opacity-50" title={item.title}>{item.title}</button>
                )}
                <button type="button" disabled={chat.busy} onClick={() => editingId === item.id ? void saveTitle() : startEditing(item)} aria-label={`重命名${item.title}`} title={editingId === item.id ? '保存名称' : '重命名'} className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-[#a9a9ad] transition-opacity hover:bg-white/[0.12] hover:text-white disabled:cursor-default disabled:opacity-50 ${editingId === item.id ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'}`}><Pencil className="h-3.5 w-3.5" /></button>
                <button type="button" disabled={chat.busy} onClick={() => setDeleteTarget(item)} aria-label={`删除${item.title}`} title="删除对话" className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-[#a9a9ad] transition-opacity hover:bg-red-500/15 hover:text-red-300 disabled:cursor-default disabled:opacity-50 ${editingId === item.id ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'}`}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
          {chat.error && <p role="alert" className="px-4 pb-2 text-xs text-red-300">{chat.error}</p>}
          <button type="button" onClick={() => { void chat.createConversation().then((created) => { if (created) setOpen(false); }); }} disabled={chat.busy} className="flex w-full cursor-pointer items-center gap-2 border-t border-white/[0.10] px-4 py-3 text-left text-sm text-[#f3f3f0] hover:bg-white/[0.08] disabled:cursor-default disabled:opacity-50"><Plus className="h-4 w-4" />新增对话</button>
        </div>
      )}
      {deleteTarget && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <section role="alertdialog" aria-modal="true" aria-labelledby="delete-chat-title" aria-describedby="delete-chat-description" onKeyDown={(event) => { if (event.key === 'Escape' && !chat.busy) setDeleteTarget(null); }} className="w-full max-w-[400px] rounded-xl border border-white/[0.14] bg-[#242424] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="delete-chat-title" className="text-base font-semibold text-white">删除对话</h2>
                <p id="delete-chat-description" className="mt-2 break-words text-sm leading-6 text-[#b9b9ba]">确定删除“{deleteTarget.title}”吗？对话记录将一并删除，且无法恢复。</p>
              </div>
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={chat.busy} aria-label="关闭" className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-[#b9b9ba] hover:bg-white/[0.08] disabled:opacity-50"><X className="h-4 w-4" /></button>
            </div>
            {chat.error && <p role="alert" className="mt-3 text-sm text-red-300">{chat.error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setDeleteTarget(null)} disabled={chat.busy} className="h-9 cursor-pointer rounded-lg border border-white/[0.14] px-4 text-sm text-[#dededb] hover:bg-white/[0.08] disabled:opacity-50">取消</button>
              <button type="button" onClick={() => void confirmDelete()} disabled={chat.busy} className="flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-red-500 px-4 text-sm font-medium text-white hover:bg-red-400 disabled:opacity-50">{chat.busy && <Loader2 className="h-4 w-4 animate-spin" />}删除</button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}
