import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AiMixJob, Asset, Project, RenderJob } from '@reel/contracts';
import { api } from '../../lib/api';

// ─── Projects ───────────────────────────────────────────────────────────────

export function useProject(id: string) {
  return useQuery<Project>({
    queryKey: ['project', id],
    queryFn: () => api.projects.get(id) as Promise<Project>,
    enabled: !!id,
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: object) => api.projects.update(id, body) as Promise<Project>,
    onSuccess: (data) => qc.setQueryData(['project', id], data),
  });
}

// ─── Assets ─────────────────────────────────────────────────────────────────

export function useAssets() {
  return useQuery<Asset[]>({
    queryKey: ['assets'],
    queryFn: () => api.assets.list() as Promise<Asset[]>,
  });
}

export function useUploadAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.assets.upload(file) as Promise<Asset>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

export function useDeleteAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.assets.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

// ─── 导出/渲染 ────────────────────────────────────────────────────────────────

/**
 * 导出：创建渲染任务，然后轮询其状态（每 1s）直到 completed/failed。
 * 返回当前任务与一个 start() 触发器。
 */
export function useExport(projectId: string) {
  const [jobId, setJobId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (opts: { fileName?: string; quality?: string }) =>
      api.render.create({ projectId, ...opts }) as Promise<RenderJob>,
    onSuccess: (job) => setJobId(job.id),
  });

  const { data: job } = useQuery<RenderJob>({
    queryKey: ['render', jobId],
    queryFn: () => api.render.get(jobId!) as Promise<RenderJob>,
    enabled: !!jobId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'completed' || s === 'failed' ? false : 1000;
    },
  });

  const reset = () => setJobId(null);

  return {
    start: (opts: { fileName?: string; quality?: string }) => create.mutate(opts),
    starting: create.isPending,
    job: job ?? null,
    reset,
  };
}

export function useAiMix(projectId: string) {
  const [jobId, setJobId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (opts: {
      assetIds: string[];
      durationSec?: number;
      style?: string;
      sellingPoints?: string[];
      cta?: string;
    }) => api.aiMix.create({ projectId, ...opts }) as Promise<AiMixJob>,
    onSuccess: (job) => setJobId(job.id),
  });

  const { data: job } = useQuery<AiMixJob>({
    queryKey: ['ai-mix', jobId],
    queryFn: () => api.aiMix.get(jobId!) as Promise<AiMixJob>,
    enabled: !!jobId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'completed' || s === 'failed' ? false : 1000;
    },
  });

  const reset = () => setJobId(null);

  return {
    start: (opts: {
      assetIds: string[];
      durationSec?: number;
      style?: string;
      sellingPoints?: string[];
      cta?: string;
    }) => create.mutate(opts),
    starting: create.isPending,
    error: create.error,
    job: job ?? null,
    reset,
  };
}
