import { ArrowUp, Loader2 } from 'lucide-react';
import type { CanvasChatReference } from '../chat-types';
import type { useCanvasChat } from '../useCanvasChat';
import { referenceIds } from '../inline-references';
import { InlineReferenceInput } from './InlineReferenceInput';

export function CanvasChatComposer({ chat, nodes }: {
  chat: ReturnType<typeof useCanvasChat>;
  nodes: CanvasChatReference[];
  onFocusNode: (nodeId: string) => void;
}) {
  function submit() {
    const ids = referenceIds(chat.draft);
    const currentReferences = ids.flatMap((id) => {
      const node = nodes.find((candidate) => candidate.id === id);
      return node ? [node] : [];
    });
    void chat.send(chat.draft, currentReferences);
  }
  return <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="relative mx-auto max-w-3xl rounded-2xl border border-white/[0.12] bg-[#1d1d1d] p-3 shadow-[0_14px_38px_rgba(0,0,0,0.28)] focus-within:border-white/[0.22]">
    <InlineReferenceInput variant="chat" value={chat.draft} candidates={nodes} maxReferences={8} onChange={(value) => { chat.setDraft(value); chat.setReferences(nodes.filter((node) => referenceIds(value).includes(node.id))); }} onSubmit={submit} placeholder="随意发挥你的想象，输入 @ 引用画布节点～" label="发送消息" />
    <div className="mt-2 flex items-center justify-between"><span className="px-1 text-[11px] text-[#59595e]">GLM-4-Flash</span><button type="submit" disabled={!chat.draft.trim() || chat.busy} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3f3f0] text-[#111111] disabled:bg-white/[0.10] disabled:text-white/30" aria-label="发送消息">{chat.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}</button></div>
  </form>;
}
