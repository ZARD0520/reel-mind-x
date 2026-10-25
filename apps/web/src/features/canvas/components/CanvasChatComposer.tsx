import { useMemo, useRef, useState } from 'react';
import { ArrowUp, Loader2 } from 'lucide-react';
import type { CanvasChatReference } from '../chat-types';
import type { useCanvasChat } from '../useCanvasChat';
import { referenceIds, referenceToken } from '../inline-references';
import { ChatAttachMenu } from './ChatAttachMenu';
import { InlineReferenceInput, type InlineReferenceInputHandle } from './InlineReferenceInput';

export function CanvasChatComposer({ chat, nodes, canvasId }: {
  chat: ReturnType<typeof useCanvasChat>;
  nodes: CanvasChatReference[];
  canvasId: string;
  onFocusNode: (nodeId: string) => void;
}) {
  const inputRef = useRef<InlineReferenceInputHandle>(null);
  const [attachments, setAttachments] = useState<CanvasChatReference[]>([]);
  const [myUploads, setMyUploads] = useState<CanvasChatReference[]>([]);
  const draftIds = useMemo(() => new Set(referenceIds(chat.draft)), [chat.draft]);

  function submit() {
    const ids = referenceIds(chat.draft);
    const pool = [...nodes, ...attachments];
    const currentReferences = ids.flatMap((id) => {
      const reference = pool.find((candidate) => candidate.id === id);
      return reference ? [reference] : [];
    });
    setAttachments((current) => current.filter((item) => !ids.includes(item.id)));
    void chat.send(chat.draft, currentReferences);
  }

  function handlePick(reference: CanvasChatReference) {
    setAttachments((current) => (current.some((item) => item.id === reference.id) ? current : [...current, reference]));
    inputRef.current?.insert(reference);
  }

  function handleConfirmPicks(references: CanvasChatReference[]) {
    setAttachments((current) => [
      ...current,
      ...references.filter((reference) => !current.some((item) => item.id === reference.id) && !nodes.some((node) => node.id === reference.id)),
    ]);
    // 弹窗确认时输入框通常未聚焦，统一追加到内容末尾
    const tokens = references.map((reference) => `${referenceToken(reference)} `).join('');
    chat.setDraft((current) => `${current}${current && !current.endsWith(' ') && !current.endsWith('\n') ? ' ' : ''}${tokens}`);
    inputRef.current?.focus();
  }

  function handleUploaded(reference: CanvasChatReference) {
    setMyUploads((current) => (current.some((item) => item.id === reference.id) ? current : [...current, reference]));
  }

  return <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="relative mx-auto max-w-3xl rounded-2xl border border-white/[0.12] bg-[#1d1d1d] p-3 shadow-[0_14px_38px_rgba(0,0,0,0.28)] focus-within:border-white/[0.22]">
    <InlineReferenceInput ref={inputRef} variant="chat" value={chat.draft} candidates={[...nodes, ...attachments]} maxReferences={8} onChange={(value) => { chat.setDraft(value); chat.setReferences(nodes.filter((node) => referenceIds(value).includes(node.id))); }} onSubmit={submit} placeholder="随意发挥你的想象，输入 @ 引用画布节点～" label="发送消息" />
    <div className="mt-2 flex items-center justify-between">
      <ChatAttachMenu canvasId={canvasId} uploads={myUploads} draftIds={draftIds} onPick={handlePick} onUploaded={handleUploaded} onConfirmPicks={handleConfirmPicks} disabled={chat.busy} />
      <button type="submit" disabled={!chat.draft.trim() || chat.busy} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3f3f0] text-[#111111] disabled:bg-white/[0.10] disabled:text-white/30" aria-label="发送消息">{chat.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}</button>
    </div>
  </form>;
}
