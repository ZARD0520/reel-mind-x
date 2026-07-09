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
    get: (id: string) => request(`/projects/${id}`),
    update: (id: string, body: object) =>
      request(`/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    remove: (id: string) => requestVoid(`/projects/${id}`, { method: 'DELETE' }),
  },
  assets: {
    list: (projectId: string) => request(`/assets?projectId=${encodeURIComponent(projectId)}`),
    upload: (projectId: string, file: File) => {
      const form = new FormData();
      form.append('file', file);
      return request(`/assets?projectId=${encodeURIComponent(projectId)}`, {
        method: 'POST',
        body: form,
      });
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
    generateImage: (body: { projectId: string; prompt: string; size?: string }) =>
      request('/ai-gen-media/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    generateVideo: (body: { projectId: string; prompt: string; size?: string }) =>
      request('/ai-gen-media/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  },
} as const;
