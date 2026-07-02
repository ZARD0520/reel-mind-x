/** 统一 fetch 客户端。所有接口都走 /api 前缀（vite dev 代理到后端）。*/
const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
  }
}

export const api = {
  projects: {
    create: (name: string) =>
      request('/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
    get: (id: string) => request(`/projects/${id}`),
    update: (id: string, body: object) =>
      request(`/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  },
  assets: {
    list: () => request('/assets'),
    upload: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return request('/assets', { method: 'POST', body: form });
    },
    remove: (id: string) => requestVoid(`/assets/${id}`, { method: 'DELETE' }),
  },
  render: {
    create: (body: { projectId: string; fileName?: string; quality?: string }) =>
      request('/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    get: (id: string) => request(`/render/${id}`),
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
    }) =>
      request('/text-gen/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  },
  aiGenMedia: {
    generateImage: (body: { prompt: string; size?: string }) =>
      request('/ai-gen-media/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    generateVideo: (body: { prompt: string }) =>
      request('/ai-gen-media/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  },
} as const;
