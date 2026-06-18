import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Asset, Project } from '@reel/contracts';
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
