import { Input, Button } from '../components/controls';
import { Panel, Toolbar, SearchForm } from '../components/containers';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { CREDIT_ENTRY_LABELS } from '@reel/contracts/credits';
import { adminApi } from '@reel/api-client';
import { Empty, ErrorBox, Pagination, Table } from '../components/ui';
import { time } from '../lib/display';

export function LedgerPage() {
  const [params, setParams] = useSearchParams();
  const userId = params.get('userId') ?? '';
  const clearUser = () => {
    const next = new URLSearchParams(params);
    next.delete('userId');
    setParams(next);
  };
  const [page, setPage] = useState(1);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['ledger', page, userId, search],
    queryFn: () =>
      adminApi.ledger(
        new URLSearchParams({
          page: String(page),
          ...(userId ? { userId } : {}),
          search,
        }).toString(),
      ),
  });
  useEffect(() => setPage(1), [userId]);
  return (
    <Panel>
      <Toolbar>
        <SearchForm
          className="w-[min(100%,470px)]"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(text.trim());
            setPage(1);
          }}
        >
          <Search size={17} />
          <Input
            aria-label="搜索关联任务"
            placeholder="输入关联任务或会话 ID"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button>查询</Button>
        </SearchForm>
        {userId && (
          <Button onClick={clearUser}>
            清除用户筛选 <X size={14} />
          </Button>
        )}
      </Toolbar>
      {userId && <p className="px-[22px] pb-[16px] text-[12px] text-accent">用户 ID：{userId}</p>}
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Empty>加载中…</Empty>
      ) : query.data?.items.length ? (
        <Table
          headings={[
            '时间',
            '用户 ID',
            '类型',
            '数量',
            '可用变化',
            '冻结变化',
            '操作后可用 / 冻结',
            '说明 / 关联记录',
          ]}
        >
          {query.data.items.map((entry) => (
            <tr key={entry.id}>
              <td>{time(entry.createdAt)}</td>
              <td className="font-mono text-[11px] [overflow-wrap:anywhere]">{entry.userId}</td>
              <td>{CREDIT_ENTRY_LABELS[entry.type] ?? entry.type}</td>
              <td>{entry.amount}</td>
              <td className={entry.availableDelta > 0 ? 'text-positive' : ''}>
                {entry.availableDelta > 0 ? '+' : ''}
                {entry.availableDelta}
              </td>
              <td>
                {entry.frozenDelta > 0 ? '+' : ''}
                {entry.frozenDelta}
              </td>
              <td>
                {entry.availableAfter} / {entry.frozenAfter}
              </td>
              <td className="min-w-[240px] max-w-[380px] whitespace-normal leading-[1.7]">
                {entry.reason}
                <small className="text-fg-muted font-mono text-[11px] [overflow-wrap:anywhere]">
                  {entry.referenceId ?? '—'}
                </small>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty />
      )}
      <Pagination data={query.data} page={page} setPage={setPage} />
    </Panel>
  );
}
