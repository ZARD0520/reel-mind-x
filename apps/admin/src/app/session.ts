import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@reel/api-client';

export function useAdminSession() {
  return useQuery({ queryKey: ['session'], queryFn: adminApi.me });
}
