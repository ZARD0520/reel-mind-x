import { useEffect, useMemo, useRef } from 'react';
import { Loader2, Maximize2, Minimize2, X } from 'lucide-react';
import { useCanvasChat } from '../useCanvasChat';
import type { CanvasChatReference } from '../chat-types';
import { CanvasChatComposer } from './CanvasChatComposer';
import { CanvasChatHistory } from './CanvasChatHistory';
import { CanvasChatMessage } from './CanvasChatMessage';
import { creditsApi } from '@reel/api-client';
import { useQuery } from '@tanstack/react-query';

export function CanvasChatDrawer({ canvasId, nodes, open, fullscreen, initialPrompt, userName, onInitialPromptConsumed, onFocusNode, onToggleFullscreen, onClose }: {
  canvasId: string;
  nodes: CanvasChatReference[];
  open: boolean;
  fullscreen: boolean;
  initialPrompt: string;
  userName: string;
  onInitialPromptConsumed: () => void;
  onFocusNode: (nodeId: string) => void;
  onToggleFullscreen: () => void;
  onClose: () => void;
}) {
  const chat = useCanvasChat(canvasId, initialPrompt, onInitialPromptConsumed);
  const quote = useQuery({ queryKey: ['credits', 'quote', 'chat'], queryFn: () => creditsApi.quote({ kind: 'chat' }), enabled: open, retry: false, staleTime: 15000 });
  const availableNodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
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
            {chat.detail.data?.messages.map((message) => <CanvasChatMessage key={message.id} role={message.role} content={message.content} references={message.references} availableNodeIds={availableNodeIds} onFocusNode={onFocusNode} />)}
            {chat.pending && <>
              <CanvasChatMessage role="user" content={chat.pending.prompt} references={chat.pending.references} availableNodeIds={availableNodeIds} onFocusNode={onFocusNode} />
              {chat.pending.answer
                ? <CanvasChatMessage key={chat.pending.key} role="assistant" content={chat.pending.answer} availableNodeIds={availableNodeIds} onFocusNode={onFocusNode} typing complete={!!chat.pending.completed} onTypingComplete={chat.finishTurn} onTypingProgress={() => bottomRef.current?.scrollIntoView({ block: 'end' })} />
                : <div className="flex items-center gap-2 text-sm text-[#99999d]"><Loader2 className="h-4 w-4 animate-spin" />思考中...</div>}
            </>}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="shrink-0 px-4 pb-4">
          {chat.error && <p role="alert" className="mb-2 px-1 text-xs text-red-400">{chat.error}</p>}
          <CanvasChatComposer chat={chat} nodes={nodes} onFocusNode={onFocusNode} />
          <p className="mt-2 px-1 text-[10px] text-[#777780]" title={quote.error?.message}>{quote.data ? `每次对话 ${quote.data.total} 积分 · 失败自动退还` : quote.error ? '暂时无法获取对话报价' : ''}</p>
        </div>
      </div>
    </aside>
  );
}
