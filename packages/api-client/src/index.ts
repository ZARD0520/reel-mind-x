import type {
  AdminAssetDetail,
  AdminAssetRow,
  AdminOverview,
  AdminProjectRow,
  AdminTask,
  AdminUser,
  AuditRecord,
  CreditBalance,
  CreditLedgerEntry,
  CreditPriceRecord,
  CreditQuote,
  CreditQuoteInput,
  PageResult,
  PlatformSettings,
  User,
} from '@reel/contracts';
import { CreditBalanceSchema, CreditQuoteSchema } from '@reel/contracts/credits';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, credentials: 'include' });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    throw new HttpError(
      response.status,
      Array.isArray(data.message)
        ? data.message.join('；')
        : (data.message ?? `请求失败（${response.status}）`),
    );
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
export const creditsApi = {
  balance: async () => {
    const data = CreditBalanceSchema.safeParse(await request<CreditBalance>('/credits/balance'));
    if (!data.success) throw new HttpError(502, '暂时无法获取积分余额');
    return data.data;
  },
  ledger: (page = 1) => request<PageResult<CreditLedgerEntry>>(`/credits/ledger?page=${page}`),
  quote: (input: Partial<CreditQuoteInput> & Pick<CreditQuoteInput, 'kind'>) =>
    request<CreditQuote>('/credits/quote', json('POST', input)).then((raw) => {
      const data = CreditQuoteSchema.safeParse(raw);
      if (!data.success) throw new HttpError(502, '暂时无法获取积分报价');
      return data.data;
    }),
};
export const adminApi = {
  me: () => request<User>('/auth/me'),
  login: (email: string, password: string) =>
    request<{ user: User }>('/auth/login', json('POST', { email, password })),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  overview: () => request<AdminOverview>('/admin/overview'),
  users: (query: string) => request<PageResult<AdminUser>>(`/admin/users?${query}`),
  userStatus: (id: string, status: string) =>
    request(`/admin/users/${id}`, json('PATCH', { status })),
  adjust: (id: string, input: { requestId: string; amount: number; reason: string }) =>
    request(`/admin/users/${id}/credits`, json('POST', input)),
  ledger: (query: string) => request<PageResult<CreditLedgerEntry>>(`/admin/ledger?${query}`),
  tasks: (query: string) => request<PageResult<AdminTask>>(`/admin/tasks?${query}`),
  projects: (query: string) => request<PageResult<AdminProjectRow>>(`/admin/projects?${query}`),
  assets: (query: string) => request<PageResult<AdminAssetRow>>(`/admin/assets?${query}`),
  asset: (id: string) => request<AdminAssetDetail>(`/admin/assets/${id}`),
  prices: () => request<CreditPriceRecord[]>('/admin/prices'),
  savePrice: (input: Pick<CreditPriceRecord, 'kind' | 'model' | 'unit' | 'credits' | 'enabled'>) =>
    request('/admin/prices', json('POST', input)),
  settings: () => request<PlatformSettings>('/admin/settings'),
  saveSettings: (input: PlatformSettings) => request('/admin/settings', json('PATCH', input)),
  audits: (query: string) => request<PageResult<AuditRecord>>(`/admin/audits?${query}`),
};
