import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { chatErrorMessage } from '@reel/contracts/chat-errors';
import type { GenerationTask } from '@reel/contracts';
import { hasPendingAgentMedia } from './agent-background';
import type { AgentPlanProgress, AgentToolProgress, CanvasAgentBridge, CanvasChatReference, Conversation, ConversationSummary } from './chat-types';

type PendingTurn = {
  key: number;
  prompt: string;
  references: CanvasChatReference[];
  answer: string;
  completed: Conversation | null;
  operations: AgentToolProgress[];
  status: string;
  plan?: AgentPlanProgress;
};

export function useCanvasChat(canvasId: string, initialPrompt: string, onInitialPromptConsumed: () => void, initialReferences: CanvasChatReference[] = [], agentBridge?: MutableRefObject<CanvasAgentBridge | null>) {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [references, setReferences] = useState<CanvasChatReference[]>([]);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failedTurns, setFailedTurns] = useState<{ key: number; conversationId: string | null; prompt: string; references: CanvasChatReference[]; answer: string }[]>([]);
  const busyRef = useRef(false);
  const initialPromptStarted = useRef(false);
  const initialReferencesRef = useRef(initialReferences);
  const turnCounter = useRef(0);
  const taskSnapshots = useQuery<GenerationTask[]>({
    queryKey: ['generation-tasks', canvasId], queryFn: () => api.generationTasks.list(canvasId), enabled: false,
  });
  const taskVersions = (taskSnapshots.data ?? []).map(task => `${task.id}:${task.revision ?? 0}`).join('|');

  const list = useQuery<ConversationSummary[]>({
    queryKey: ['canvas-conversations', canvasId],
    queryFn: () => api.canvasChat.list(canvasId) as Promise<ConversationSummary[]>,
  });
  const detail = useQuery<Conversation>({
    queryKey: ['canvas-conversation', canvasId, activeId],
    queryFn: () => api.canvasChat.get(canvasId, activeId!) as Promise<Conversation>,
    enabled: !!activeId,
    refetchInterval: (query) => hasPendingAgentMedia(query.state.data, taskSnapshots.data) ? 3000 : false,
  });
  const mediaPending = hasPendingAgentMedia(detail.data, taskSnapshots.data);
  const inspectedTaskVersions = useRef('');
  useEffect(() => {
    const key = `${canvasId}:${activeId}:${taskVersions}`;
    if (!activeId || !mediaPending || inspectedTaskVersions.current === key) return;
    inspectedTaskVersions.current = key;
    void queryClient.invalidateQueries({ queryKey: ['canvas-conversation', canvasId, activeId] });
  }, [taskVersions, mediaPending, activeId, canvasId, queryClient]);
  const wasGenerating = useRef(false);
  useEffect(() => {
    const generating = mediaPending;
    if (generating || wasGenerating.current) {
      void queryClient.invalidateQueries({ queryKey: ['generation-tasks', canvasId] });
      void queryClient.invalidateQueries({ queryKey: ['credits'] });
      if (!busyRef.current) void agentBridge?.current?.sync?.().catch(() => setError('画布同步失败，请刷新页面查看已执行结果'));
    }
    wasGenerating.current = generating;
  }, [detail.dataUpdatedAt, mediaPending, canvasId, queryClient, agentBridge]);

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
    setPending({ key: ++turnCounter.current, prompt: text, references: selectedReferences, answer: '', completed: null, operations: [], status: '' });
    const bridge = agentBridge?.current;
    let completed: Conversation | null = null;
    let id = activeId;
    const turnKey = turnCounter.current;
    let phase = 'prepare_canvas';
    try {
      if (agentBridge && !bridge) throw new Error('画布尚未就绪，请稍后重试');
      const context = await bridge?.prepare();
      if (!id) {
        phase = 'create_conversation';
        const created = await api.canvasChat.create(canvasId) as ConversationSummary;
        id = created.id;
        setActiveId(id);
        void queryClient.invalidateQueries({ queryKey: ['canvas-conversations', canvasId] });
      }
      phase = 'send_agent';
      const updated = await api.canvasChat.sendStream(canvasId, id, text, selectedReferences, (delta) => {
        setPending((current) => current ? { ...current, status: '', answer: current.answer + delta } : current);
      }, undefined, {
        selectedNodeIds: context?.selectedNodeIds ?? [],
        onTool: (tool) => setPending(current => current ? { ...current, status: '', operations: [...current.operations.filter(item => item.id !== tool.id), tool] } : current),
        onStatus: (status) => setPending(current => current ? { ...current, status } : current),
        onReplace: (answer) => setPending(current => current ? { ...current, status: '', answer } : current),
        onCanvas: (graph) => bridge?.apply(graph),
        onPlan: (plan) => setPending(current => current ? { ...current, plan } : current),
      });
      completed = updated;
    } catch (cause) {
      // Failures before fetch (for example a missing browser API) never reach
      // server logs. Keep client diagnostics free of request/response bodies.
      console.error('[CanvasAgent] submission failed', {
        phase, canvasId, conversationId: id,
        secureContext: globalThis.isSecureContext,
        nativeRandomUuidAvailable: typeof globalThis.crypto?.randomUUID === 'function',
        error: cause instanceof ApiError ? { name: cause.name, status: cause.status, message: cause.message }
          : cause instanceof Error ? { name: cause.name, message: cause.message } : { name: 'UnknownError' },
      });
      setPending(null);
      setFailedTurns(current => [...current, { key: turnKey, conversationId: id, prompt: text, references: selectedReferences, answer: chatErrorMessage(cause) }]);
      void queryClient.invalidateQueries({ queryKey: ['canvas-conversation', canvasId] });
    } finally {
      try { await bridge?.release(); } catch { setError('画布同步失败，请刷新页面查看已执行结果'); }
      if (completed) setPending((current) => current ? { ...current, status: '', completed } : current);
      else { busyRef.current = false; setBusy(false); }
      void queryClient.invalidateQueries({ queryKey: ['credits'] });
    }
  }, [activeId, canvasId, queryClient, references, agentBridge]);

  useEffect(() => {
    if (!initialPrompt.trim() || initialPromptStarted.current) return;
    initialPromptStarted.current = true;
    onInitialPromptConsumed();
    void send(initialPrompt, [...initialReferencesRef.current, ...references]);
    // 首条消息只在进入画布时自动发送一次，引用以跳转携带的为准
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt, onInitialPromptConsumed, send]);

  const finishTurn = useCallback(() => {
    if (!pending?.completed || !activeId) return;
    queryClient.setQueryData(['canvas-conversation', canvasId, activeId], pending.completed);
    void queryClient.invalidateQueries({ queryKey: ['canvas-conversations', canvasId] });
    setPending(null);
    busyRef.current = false;
    setBusy(false);
  }, [activeId, canvasId, pending, queryClient]);

  useEffect(() => {
    // Cached/idempotent replies may contain only `done`. There is no animated
    // message to call finishTurn in that case, but the composer must unlock.
    if (pending?.completed && !pending.answer.trim()) finishTurn();
  }, [finishTurn, pending?.completed, pending?.answer]);

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
  return { activeId, list, detail, title, draft, setDraft, references, setReferences, pending, failedTurns: failedTurns.filter(turn => turn.conversationId === activeId), busy, error, send, finishTurn, createConversation, selectConversation, renameConversation, deleteConversation };
}
