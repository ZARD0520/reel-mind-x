import { useRef, useState } from 'react';
import { ArrowUp, FileText, Film, Image as ImageIcon, Loader2, X } from 'lucide-react';
import type { CanvasChatReference } from '../chat-types';
import type { useCanvasChat } from '../useCanvasChat';

const icons = { text: FileText, image: ImageIcon, video: Film };
const labels = { text: '文本', image: '图片', video: '视频' };

export function CanvasChatComposer({ chat, nodes }: {
  chat: ReturnType<typeof useCanvasChat>;
  nodes: CanvasChatReference[];
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const matches = mention && chat.references.length < 8
    ? nodes.filter((node) => !chat.references.some((reference) => reference.id === node.id)
      && `${node.title} ${labels[node.kind]}`.toLocaleLowerCase().includes(mention.query.toLocaleLowerCase())).slice(0, 8)
    : [];

  function updateMention(value: string, cursor: number) {
    const before = value.slice(0, cursor);
    const found = /@([^@\s]*)$/.exec(before);
    setMention(found ? { start: cursor - found[0].length, end: cursor, query: found[1] ?? '' } : null);
    setHighlighted(0);
  }

  function selectNode(node: CanvasChatReference) {
    if (!mention) return;
    const next = `${chat.draft.slice(0, mention.start)}${chat.draft.slice(mention.end)}`;
    chat.setDraft(next);
    chat.setReferences((current) => [...current, node]);
    setMention(null);
    const cursor = mention.start;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  function submit() {
    setMention(null);
    const currentReferences = chat.references.flatMap((reference) => {
      const currentNode = nodes.find((node) => node.id === reference.id);
      return currentNode ? [currentNode] : [];
    });
    void chat.send(chat.draft, currentReferences);
  }

  return (
    <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="relative mx-auto max-w-3xl rounded-2xl border border-white/[0.12] bg-[#1d1d1d] p-3 shadow-[0_14px_38px_rgba(0,0,0,0.28)] focus-within:border-white/[0.22]">
      {mention && (
        <div role="listbox" aria-label="引用画布节点" className="reel-scroll absolute bottom-full left-0 z-40 mb-2 max-h-60 w-full overflow-y-auto rounded-xl border border-white/[0.14] bg-[#282828] p-1.5 shadow-2xl">
          {matches.length ? matches.map((node, index) => {
            const Icon = icons[node.kind];
            return <button key={node.id} type="button" role="option" aria-selected={highlighted === index} onMouseDown={(event) => event.preventDefault()} onClick={() => selectNode(node)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-[#dededb] ${highlighted === index ? 'bg-white/[0.10]' : 'hover:bg-white/[0.08]'}`}><Icon className="h-4 w-4 shrink-0 text-[#a9a9ad]" /><span className="min-w-0 flex-1 truncate">{node.title}</span><span className="text-xs text-[#88888d]">{labels[node.kind]}</span></button>;
          }) : <p className="px-3 py-2 text-xs text-[#929296]">{chat.references.length >= 8 ? '最多引用 8 个节点' : '没有匹配的节点'}</p>}
        </div>
      )}
      {!!chat.references.length && <div className="mb-2 flex flex-wrap gap-1.5" aria-label="已引用的画布节点">
        {chat.references.map((reference) => {
          const Icon = icons[reference.kind];
          return <span key={reference.id} className="inline-flex max-w-full items-center gap-1 rounded-md bg-white/[0.10] px-2 py-1 text-xs text-[#dededb]"><Icon className="h-3.5 w-3.5 shrink-0" /><span className="max-w-44 truncate">{reference.title}</span><button type="button" onClick={() => chat.setReferences((current) => current.filter((item) => item.id !== reference.id))} aria-label={`移除引用${reference.title}`} className="rounded p-0.5 hover:bg-white/[0.12]"><X className="h-3 w-3" /></button></span>;
        })}
      </div>}
      <textarea ref={inputRef} value={chat.draft} onChange={(event) => { chat.setDraft(event.target.value); updateMention(event.target.value, event.target.selectionStart); }} onClick={(event) => updateMention(chat.draft, event.currentTarget.selectionStart)} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (mention && matches.length && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
          event.preventDefault();
          if (event.key === 'ArrowDown') setHighlighted((index) => (index + 1) % matches.length);
          if (event.key === 'ArrowUp') setHighlighted((index) => (index - 1 + matches.length) % matches.length);
          if (event.key === 'Enter') selectNode(matches[highlighted]!);
          return;
        }
        if (event.key === 'Escape' && mention) { event.preventDefault(); setMention(null); return; }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); }
      }} rows={3} placeholder="随意发挥你的想象，输入 @ 引用画布节点～" aria-label="发送消息" className="block min-h-[72px] w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-[#f3f3f0] outline-none placeholder:text-[#68686d]" />
      <div className="mt-2 flex items-center justify-between"><span className="px-1 text-[11px] text-[#59595e]">GLM-4-Flash</span><button type="submit" disabled={(!chat.draft.trim() && !chat.references.length) || chat.busy} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3f3f0] text-[#111111] disabled:bg-white/[0.10] disabled:text-white/30" aria-label="发送消息">{chat.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}</button></div>
    </form>
  );
}
