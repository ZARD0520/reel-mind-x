import { useEffect, useRef } from 'react';
import { ArrowUp, Loader2, Maximize2, Minimize2, X } from 'lucide-react';
import { useCanvasChat } from '../useCanvasChat';
import { CanvasChatHistory } from './CanvasChatHistory';
import { CanvasChatMessage } from './CanvasChatMessage';

export function CanvasChatDrawer({ canvasId, open, fullscreen, initialPrompt, userName, onInitialPromptConsumed, onToggleFullscreen, onClose }: {
  canvasId: string;
  open: boolean;
  fullscreen: boolean;
  initialPrompt: string;
  userName: string;
  onInitialPromptConsumed: () => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
}) {
  const chat = useCanvasChat(canvasId, initialPrompt, onInitialPromptConsumed);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat.detail.data?.messages.length, chat.pending?.answer]);

  return (
    <aside aria-hidden={!open} className={`relative z-30 h-full shrink-0 overflow-hidden bg-[#111111] transition-[width,border-color] duration-300 ease-out ${open ? fullscreen ? 'w-full border-l border-white/[0.10]' : 'w-[min(420px,86vw)] border-l border-white/[0.10]' : 'w-0 border-l border-transparent'}`}>
      <div className={`flex h-full min-w-0 flex-col transition-opacity duration-200 ${open ? 'opacity-100 delay-100' : 'pointer-events-none opacity-0'}`}>
        <header className="flex h-16 shrink-0 items-center border-b border-white/[0.09] px-4">
          <CanvasChatHistory chat={chat} />
          <div className="ml-2 flex items-center gap-1">
            <button type="button" onClick={onToggleFullscreen} className="flex h-9 w-9 items-center justify-center rounded-lg text-[#9b9b9f] hover:bg-white/[0.08] hover:text-white" aria-label={fullscreen ? '退出全屏' : '全屏显示对话'} title={fullscreen ? '退出全屏' : '全屏显示对话'}>{fullscreen ? <Minimize2 className="h-[17px] w-[17px]" /> : <Maximize2 className="h-[17px] w-[17px]" />}</button>
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-[#9b9b9f] hover:bg-white/[0.08] hover:text-white" aria-label="收起对话" title="收起对话"><X className="h-[18px] w-[18px]" /></button>
          </div>
        </header>

        <div className="reel-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {chat.detail.isLoading && chat.activeId && !chat.pending && <div className="flex justify-center pt-8"><Loader2 className="h-5 w-5 animate-spin text-[#99999d]" /></div>}
          {!chat.detail.data?.messages.length && !chat.pending && !chat.detail.isLoading && <div className="flex h-full flex-col items-center justify-center text-center"><h2 className="text-xl font-semibold text-[#dededb]">Hi～{userName}</h2><p className="mt-2 text-sm text-[#89898d]">今天想创作点什么？</p></div>}
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {chat.detail.data?.messages.map((message) => <CanvasChatMessage key={message.id} role={message.role} content={message.content} />)}
            {chat.pending && <>
              <CanvasChatMessage role="user" content={chat.pending.prompt} />
              {chat.pending.answer
                ? <CanvasChatMessage key={chat.pending.key} role="assistant" content={chat.pending.answer} typing complete={!!chat.pending.completed} onTypingComplete={chat.finishTurn} onTypingProgress={() => bottomRef.current?.scrollIntoView({ block: 'end' })} />
                : <div className="flex items-center gap-2 text-sm text-[#99999d]"><Loader2 className="h-4 w-4 animate-spin" />思考中...</div>}
            </>}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="shrink-0 px-4 pb-4">
          {chat.error && <p role="alert" className="mb-2 px-1 text-xs text-red-400">{chat.error}</p>}
          <form onSubmit={(event) => { event.preventDefault(); void chat.send(chat.draft); }} className="mx-auto max-w-3xl rounded-2xl border border-white/[0.12] bg-[#1d1d1d] p-3 shadow-[0_14px_38px_rgba(0,0,0,0.28)] focus-within:border-white/[0.22]">
            <textarea value={chat.draft} onChange={(event) => chat.setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void chat.send(chat.draft); } }} rows={3} placeholder="随意发挥你的想象～" aria-label="发送消息" className="block min-h-[72px] w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-[#f3f3f0] outline-none placeholder:text-[#68686d]" />
            <div className="mt-2 flex items-center justify-between"><span className="px-1 text-[11px] text-[#59595e]">GLM-4-Flash</span><button type="submit" disabled={!chat.draft.trim() || chat.busy} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3f3f0] text-[#111111] disabled:bg-white/[0.10] disabled:text-white/30" aria-label="发送消息">{chat.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}</button></div>
          </form>
        </div>
      </div>
    </aside>
  );
}
