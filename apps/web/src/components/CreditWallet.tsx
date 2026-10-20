import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Coins, RefreshCw, X } from 'lucide-react';
import { creditsApi } from '@reel/api-client';
import { CREDIT_ENTRY_LABELS } from '@reel/contracts/credits';

export function CreditWallet({ enabled = true }: { enabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const balance = useQuery({
    queryKey: ['credits', 'balance'],
    queryFn: creditsApi.balance,
    enabled,
    retry: false,
    refetchInterval: enabled ? 10000 : false,
  });
  const ledger = useQuery({
    queryKey: ['credits', 'ledger', page],
    queryFn: () => creditsApi.ledger(page),
    enabled: enabled && open,
    retry: false,
    refetchInterval: open ? 10000 : false,
  });
  if (!enabled) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setPage(1);
          setOpen(true);
          void balance.refetch();
        }}
        className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-white/[0.12] bg-[#202020] px-3 text-xs text-[#d8d8de] transition-colors hover:bg-[#303030]"
        aria-label="查看积分账户"
      >
        <Coins className="h-4 w-4 text-[#c3b4f7]" />
        {balance.data ? `${balance.data.available.toLocaleString()} 积分` : '积分账户'}
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 p-5 backdrop-blur-sm"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="credits-title"
              className="flex max-h-[85vh] w-full max-w-[760px] flex-col overflow-hidden rounded-xl border border-white/15 bg-[#1c1c22] text-[#e8e8ed] shadow-2xl"
            >
              <div className="flex items-center justify-between p-5">
                <h2 id="credits-title" className="text-base font-semibold">
                  积分账户
                </h2>
                <button
                  autoFocus
                  aria-label="关闭积分账户"
                  onClick={() => setOpen(false)}
                  className="cursor-pointer rounded-md p-2 hover:bg-white/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3 px-5 pb-5">
                {[
                  { label: '可用积分', value: balance.data?.available },
                  { label: '冻结积分', value: balance.data?.frozen },
                  { label: '累计消耗', value: balance.data?.spent },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="rounded-lg border border-white/10 bg-white/[0.025] p-4"
                  >
                    <div className="text-xs text-[#92929e]">{item.label}</div>
                    <strong className="mt-2 block text-2xl font-medium">
                      {item.value?.toLocaleString() ?? '—'}
                    </strong>
                  </div>
                ))}
              </div>
              <p className="px-5 pb-4 text-xs leading-5 text-[#92929e]">
                生成前冻结积分，成功后扣除，失败自动退还。结果待确认时保留冻结，确认结果后结算。
              </p>
              {(balance.error || ledger.error) && (
                <div
                  role="alert"
                  className="mx-5 mb-3 rounded-lg bg-red-400/10 p-3 text-xs text-red-300"
                >
                  {(balance.error || ledger.error)?.message}
                  <button
                    onClick={() => {
                      void balance.refetch();
                      void ledger.refetch();
                    }}
                    className="ml-3 inline-flex cursor-pointer items-center gap-1"
                  >
                    <RefreshCw className="h-3 w-3" />
                    重试
                  </button>
                </div>
              )}
              <div className="min-h-0 overflow-auto border-y border-white/10">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-[#25252c] text-[#9999a6]">
                    <tr>
                      {['时间', '类型', '可用变化', '冻结变化', '说明'].map((title) => (
                        <th key={title} className="whitespace-nowrap px-4 py-3 font-normal">
                          {title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.data?.items.map((entry) => (
                      <tr key={entry.id} className="border-t border-white/[0.06]">
                        <td className="whitespace-nowrap px-4 py-3 text-[#9999a6]">
                          {new Date(entry.createdAt).toLocaleString('zh-CN', { hour12: false })}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          {CREDIT_ENTRY_LABELS[entry.type] ?? entry.type}
                        </td>
                        <td
                          className={`px-4 py-3 ${entry.availableDelta > 0 ? 'text-emerald-300' : ''}`}
                        >
                          {entry.availableDelta > 0 ? '+' : ''}
                          {entry.availableDelta}
                        </td>
                        <td className="px-4 py-3">
                          {entry.frozenDelta > 0 ? '+' : ''}
                          {entry.frozenDelta}
                        </td>
                        <td className="min-w-40 px-4 py-3">{entry.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {ledger.isPending && (
                  <p className="p-8 text-center text-xs text-[#9999a6]">加载中…</p>
                )}
                {ledger.data?.total === 0 && (
                  <p className="p-8 text-center text-xs text-[#9999a6]">暂无积分流水</p>
                )}
              </div>
              <div className="flex items-center justify-between p-4 text-xs text-[#9999a6]">
                <span>共 {ledger.data?.total ?? 0} 条</span>
                <div className="flex items-center gap-4">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                    className="cursor-pointer hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    上一页
                  </button>
                  <span>{page}</span>
                  <button
                    disabled={!ledger.data || page * ledger.data.pageSize >= ledger.data.total}
                    onClick={() => setPage(page + 1)}
                    className="cursor-pointer hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    下一页
                  </button>
                </div>
              </div>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}

export function GenerationCreditCost({
  kind,
  model,
  count,
  duration,
}: {
  kind: 'text' | 'image' | 'video' | 'audio';
  model: string;
  count: number;
  duration: 5 | 10;
}) {
  const quote = useQuery({
    queryKey: ['credits', 'quote', kind, model, count, duration],
    queryFn: () =>
      creditsApi.quote({ kind: kind as 'text' | 'image' | 'video', model, count, duration }),
    enabled: kind !== 'audio',
    retry: false,
    staleTime: 15000,
    refetchInterval: 30000,
  });
  if (kind === 'audio') return null;
  return (
    <span
      className="whitespace-nowrap px-1 text-[10px] text-[#92929e]"
      title={quote.error?.message ?? '提交时冻结，成功扣除，失败退还'}
    >
      {quote.data ? `预计 ${quote.data.total} 积分` : quote.error ? '报价不可用' : '计算积分…'}
    </span>
  );
}
