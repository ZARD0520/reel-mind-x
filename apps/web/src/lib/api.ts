import { SseDecoder } from '@reel/contracts/sse';
import type { CanvasChatReference, Conversation } from '../features/canvas/chat-types';

const BASE = '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(`${init?.method ?? 'GET'} ${path} -> ${res.status}`, res.status, body);
  }
  return res.json() as Promise<T>;
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(`${init?.method ?? 'GET'} ${path} -> ${res.status}`, res.status, body);
  }
}

export const api = {
  auth: {
    me: () => request('/auth/me'),
    login: (body: { email: string; password: string }) =>
      request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    register: (body: { email: string; password: string; name: string }) =>
      request('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    logout: () => requestVoid('/auth/logout', { method: 'POST' }),
  },
  projects: {
    list: () => request('/projects'),
    create: (name: string) =>
      request('/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    createFromCanvasVideo: (body: { assetId: string; name?: string }) =>
      request('/projects/from-canvas-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    get: (id: string) => request(`/projects/${id}`),
    update: (id: string, body: object) =>
      request(`/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    remove: (id: string) => requestVoid(`/projects/${id}`, { method: 'DELETE' }),
  },
  canvases: {
    list: () => request('/canvases'),
    create: (name?: string) =>
      request('/canvases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(name ? { name } : {}),
      }),
    get: (id: string) => request(`/canvases/${id}`),
    update: (id: string, body: object) =>
      request(`/canvases/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    remove: (id: string) => requestVoid(`/canvases/${id}`, { method: 'DELETE' }),
  },
  canvasChat: {
    list: (canvasId: string) => request(`/canvases/${canvasId}/conversations`),
    create: (canvasId: string) => request(`/canvases/${canvasId}/conversations`, { method: 'POST' }),
    get: (canvasId: string, conversationId: string) =>
      request(`/canvases/${canvasId}/conversations/${conversationId}`),
    rename: (canvasId: string, conversationId: string, title: string) =>
      request(`/canvases/${canvasId}/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      }),
    remove: (canvasId: string, conversationId: string) =>
      requestVoid(`/canvases/${canvasId}/conversations/${conversationId}`, { method: 'DELETE' }),
    sendStream: async (canvasId: string, conversationId: string, content: string, references: CanvasChatReference[], onDelta: (text: string) => void, signal?: AbortSignal): Promise<Conversation> => {
      const path = `/canvases/${canvasId}/conversations/${conversationId}/messages`;
      const response = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, references }),
        credentials: 'include',
        signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.text().catch(() => '');
        throw new ApiError(`POST ${path} -> ${response.status}`, response.status, body);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const sse = new SseDecoder();
      let completed: Conversation | undefined;
      try {
        while (true) {
          const { done, value } = await reader.read();
          const events = done
            ? [...sse.push(decoder.decode()), ...sse.finish()]
            : sse.push(decoder.decode(value, { stream: true }));
          for (const event of events) {
            const data = JSON.parse(event.data) as { text?: string; message?: string } | Conversation;
            if (event.event === 'delta' && typeof (data as { text?: string }).text === 'string') {
              onDelta((data as { text: string }).text);
            }
            if (event.event === 'done') completed = data as Conversation;
            if (event.event === 'error') throw new Error((data as { message: string }).message);
          }
          if (done) break;
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      if (!completed) throw new Error('对话流中断，请重试');
      return completed;
    },
  },
  assets: {
    list: (projectId: string) => request(`/assets?projectId=${encodeURIComponent(projectId)}`),
    get: (id: string) => request(`/assets/${id}`),
    upload: (projectId: string, file: File) => {
      const form = new FormData();
      form.append('file', file);
      return request(`/assets?projectId=${encodeURIComponent(projectId)}`, {
        method: 'POST',
        body: form,
      });
    },
    remove: (id: string) => requestVoid(`/assets/${id}`, { method: 'DELETE' }),
    rename: (id: string, name: string) =>
      request(`/assets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    history: (params: { scope: 'all' | 'canvas'; canvasId?: string; q?: string }) => {
      const search = new URLSearchParams({ scope: params.scope });
      if (params.canvasId) search.set('canvasId', params.canvasId);
      if (params.q) search.set('q', params.q);
      return request(`/assets/history?${search.toString()}`);
    },
    saveToLibrary: (id: string, folderId: string, name?: string) =>
      request(`/assets/${id}/save-to-library`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(name ? { folderId, name } : { folderId }),
      }),
  },
  assetFolders: {
    list: (scope: 'personal' | 'team') =>
      request(`/asset-folders?scope=${encodeURIComponent(scope)}`),
    create: (body: { name: string; scope?: 'personal' | 'team'; parentId?: string }) =>
      request('/asset-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    listAssets: (id: string) => request(`/asset-folders/${id}/assets`),
    createTextAsset: (folderId: string, body: { name: string; content: string; prompt?: string }) =>
      request(`/asset-folders/${folderId}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    searchAssets: (q: string) =>
      request(`/asset-folders/search?q=${encodeURIComponent(q)}`),
    rename: (id: string, name: string) =>
      request(`/asset-folders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    remove: (id: string) => requestVoid(`/asset-folders/${id}`, { method: 'DELETE' }),
  },
  render: {
    create: (body: { projectId: string; fileName?: string; quality?: string }) =>
      request('/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    get: (id: string) => request(`/render/${id}`),
    latest: (projectId: string) => request(`/render?projectId=${encodeURIComponent(projectId)}`),
    cancel: (id: string) => request(`/render/${id}/cancel`, { method: 'POST' }),
  },
  aiMix: {
    create: (body: {
      projectId: string;
      assetIds: string[];
      durationSec?: number;
      style?: string;
      sellingPoints?: string[];
      cta?: string;
    }) =>
      request('/ai-mix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    get: (id: string) => request(`/ai-mix/${id}`),
  },
  textGen: {
    generate: (body: {
      prompt?: string;
      messages?: { role: 'user' | 'assistant'; content: string }[];
      maxLength?: number;
      temperature?: number;
      model?: string;
    }) =>
      request('/text-gen/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  },
  aiGenMedia: {
    generateImage: (body: {
      projectId?: string;
      canvasId?: string;
      prompt: string;
      size?: string;
      model?: string;
    }) =>
      request('/ai-gen-media/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    generateVideo: (body: {
      projectId?: string;
      canvasId?: string;
      prompt: string;
      size?: string;
      duration?: 5 | 10;
      withAudio?: boolean;
      model?: string;
      imageAssetIds?: string[];
    }) =>
      request('/ai-gen-media/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  },
} as const;
