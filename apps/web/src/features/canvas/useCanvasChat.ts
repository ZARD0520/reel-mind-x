import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { CanvasChatReference, Conversation, ConversationSummary } from './chat-types';

type PendingTurn = {
  key: number;
  prompt: string;
  references: CanvasChatReference[];
  answer: string;
  completed: Conversation | null;
};

export function useCanvasChat(canvasId: string, initialPrompt: string, onInitialPromptConsumed: () => void) {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [references, setReferences] = useState<CanvasChatReference[]>([]);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const initialPromptStarted = useRef(false);
  const turnCounter = useRef(0);

  const list = useQuery<ConversationSummary[]>({
    queryKey: ['canvas-conversations', canvasId],
    queryFn: () => api.canvasChat.list(canvasId) as Promise<ConversationSummary[]>,
  });
  const detail = useQuery<Conversation>({
    queryKey: ['canvas-conversation', canvasId, activeId],
    queryFn: () => api.canvasChat.get(canvasId, activeId!) as Promise<Conversation>,
    enabled: !!activeId,
  });

  useEffect(() => {
    if (initialPrompt || initialPromptStarted.current || busy || activeId || !list.data?.length) return;
    setActiveId(list.data[0]!.id);
  }, [activeId, busy, initialPrompt, list.data]);

  const send = useCallback(async (content: string, selectedReferences = references) => {
    const text = content.trim() || (selectedReferences.length ? '请分析我引用的资源。' : '');
    if (!text || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setDraft('');
    setReferences([]);
    setPending({ key: ++turnCounter.current, prompt: text, references: selectedReferences, answer: '', completed: null });
    try {
      let id = activeId;
      if (!id) {
        const created = await api.canvasChat.create(canvasId) as ConversationSummary;
        id = created.id;
        setActiveId(id);
        void queryClient.invalidateQueries({ queryKey: ['canvas-conversations', canvasId] });
      }
      const updated = await api.canvasChat.sendStream(canvasId, id, text, selectedReferences, (delta) => {
        setPending((current) => current ? { ...current, answer: current.answer + delta } : current);
      });
      setPending((current) => current ? { ...current, completed: updated } : current);
    } catch (cause) {
      setPending(null);
      setDraft(text);
      setReferences(selectedReferences);
      setError(cause instanceof Error && cause.message === '对话流中断，请重试' ? cause.message : '发送失败，请重试');
      busyRef.current = false;
      setBusy(false);
    }
  }, [activeId, canvasId, queryClient, references]);

  useEffect(() => {
    if (!initialPrompt.trim() || initialPromptStarted.current) return;
    initialPromptStarted.current = true;
    onInitialPromptConsumed();
    void send(initialPrompt);
  }, [initialPrompt, onInitialPromptConsumed, send]);

  const finishTurn = useCallback(() => {
    if (!pending?.completed || !activeId) return;
    queryClient.setQueryData(['canvas-conversation', canvasId, activeId], pending.completed);
    void queryClient.invalidateQueries({ queryKey: ['canvas-conversations', canvasId] });
    setPending(null);
    busyRef.current = false;
    setBusy(false);
  }, [activeId, canvasId, pending, queryClient]);

  const createConversation = useCallback(async () => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const created = await api.canvasChat.create(canvasId) as ConversationSummary;
      setActiveId(created.id);
      setDraft('');
      setReferences([]);
      await queryClient.invalidateQueries({ queryKey: ['canvas-conversations', canvasId] });
      return true;
    } catch {
      setError('新建对话失败，请重试');
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [canvasId, queryClient]);

  const selectConversation = useCallback((id: string) => {
    if (busyRef.current) return;
    setActiveId(id);
    setReferences([]);
    setError('');
  }, []);

  const renameConversation = useCallback(async (id: string, title: string) => {
    const name = title.trim();
    if (!name || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const updated = await api.canvasChat.rename(canvasId, id, name) as ConversationSummary;
      queryClient.setQueryData<ConversationSummary[]>(['canvas-conversations', canvasId], (items) =>
        items?.map((item) => item.id === id ? updated : item));
      queryClient.setQueryData<Conversation>(['canvas-conversation', canvasId, id], (item) =>
        item ? { ...item, title: updated.title, updatedAt: updated.updatedAt } : item);
      void queryClient.invalidateQueries({ queryKey: ['canvas-conversations', canvasId] });
      return true;
    } catch {
      setError('重命名失败，请重试');
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [canvasId, queryClient]);

  const deleteConversation = useCallback(async (id: string) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await api.canvasChat.remove(canvasId, id);
      const remaining = (queryClient.getQueryData<ConversationSummary[]>(['canvas-conversations', canvasId]) ?? [])
        .filter((item) => item.id !== id);
      queryClient.setQueryData(['canvas-conversations', canvasId], remaining);
      if (activeId === id) setActiveId(remaining[0]?.id ?? null);
      queryClient.removeQueries({ queryKey: ['canvas-conversation', canvasId, id], exact: true });
      void queryClient.invalidateQueries({ queryKey: ['canvas-conversations', canvasId] });
      return true;
    } catch {
      setError('删除对话失败，请重试');
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [activeId, canvasId, queryClient]);

  const title = detail.data?.title ?? list.data?.find((item) => item.id === activeId)?.title ?? '新对话';
  return { activeId, list, detail, title, draft, setDraft, references, setReferences, pending, busy, error, send, finishTurn, createConversation, selectConversation, renameConversation, deleteConversation };
}
