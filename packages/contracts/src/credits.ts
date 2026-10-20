import { z } from 'zod';

export const CreditKindSchema = z.enum(['text', 'image', 'video', 'chat']);
export const CreditQuoteInputSchema = z.object({
  kind: CreditKindSchema,
  model: z.string().trim().min(1).max(100).optional(),
  count: z.number().int().min(1).max(4).default(1),
  duration: z.union([z.literal(5), z.literal(10)]).default(5),
});
export type CreditQuoteInput = z.infer<typeof CreditQuoteInputSchema>;
export const CreditQuoteSchema = z.object({
  kind: CreditKindSchema,
  model: z.string(),
  priceId: z.string(),
  version: z.number(),
  unit: z.enum(['request', 'second']),
  unitCredits: z.number(),
  perItem: z.number(),
  count: z.number(),
  total: z.number(),
});
export type CreditQuote = z.infer<typeof CreditQuoteSchema>;
export const CreditBalanceSchema = z.object({
  available: z.number().int().nonnegative(),
  frozen: z.number().int().nonnegative(),
  spent: z.number().int().nonnegative(),
});
export type CreditBalance = z.infer<typeof CreditBalanceSchema>;
export interface CreditLedgerEntry {
  id: string;
  userId: string;
  type: string;
  amount: number;
  availableDelta: number;
  frozenDelta: number;
  availableAfter: number;
  frozenAfter: number;
  reason: string;
  referenceId: string | null;
  actorId: string | null;
  createdAt: string;
}
export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).default(''),
  userId: z.string().uuid().optional(),
  status: z.string().max(30).optional(),
});
export const AdjustCreditsSchema = z.object({
  requestId: z.string().uuid(),
  amount: z
    .number()
    .int()
    .min(-1000000)
    .max(1000000)
    .refine((value) => value !== 0),
  reason: z.string().trim().min(2).max(300),
});
export const CreditPriceInputSchema = z
  .object({
    kind: CreditKindSchema,
    model: z.string().trim().min(1).max(100),
    unit: z.enum(['request', 'second']),
    credits: z.number().int().min(0).max(100000),
    enabled: z.boolean(),
  })
  .refine((input) => input.kind === 'video' || input.unit === 'request', {
    message: '只有视频支持按秒计费',
  });
export interface CreditPriceRecord extends z.infer<typeof CreditPriceInputSchema> {
  id: string;
  version: number;
  updatedAt: string;
}
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  status: string;
  role: string;
  createdAt: string;
  creditAccount: CreditBalance | null;
}
export interface AdminTask {
  id: string;
  userId: string;
  kind: string;
  model: string;
  status: string;
  createdAt: string;
  user: { name: string; email: string };
  creditQuote: CreditQuote | null;
  items: {
    id: string;
    status: string;
    error: string | null;
    creditCost: number;
    creditHoldId: string | null;
    providerTaskId: string | null;
  }[];
  settlements: { id: string; status: string; amount: number }[];
}
export interface AuditRecord {
  id: string;
  actorId: string;
  action: string;
  targetId: string;
  detail: unknown;
  createdAt: string;
}
export interface AdminOverview {
  users: number;
  tasks: number;
  completed: number;
  failed: number;
  active: number;
  available: number;
  frozen: number;
  spent: number;
  models: {
    kind: string;
    model: string;
    tasks: number;
    completed: number;
    failed: number;
    spent: number;
  }[];
}
export const CREDIT_ENTRY_LABELS: Record<string, string> = {
  grant: '试用赠送',
  adjustment: '人工调整',
  reserve: '生成冻结',
  capture: '生成扣除',
  refund: '失败退还',
};
export const PlatformSettingsSchema = z.object({
  signupCredits: z.number().int().min(0).max(1000000),
  dailyCredits: z.number().int().min(0).max(10000000).default(10000),
  maxConcurrent: z.number().int().min(1).max(100).default(3),
});
export type PlatformSettings = z.infer<typeof PlatformSettingsSchema>;
