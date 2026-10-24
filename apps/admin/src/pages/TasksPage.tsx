import { Input, Button, Select } from '../components/controls';
import { Panel, Toolbar, SearchForm } from '../components/containers';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { adminApi } from '@reel/api-client';
import { Badge, Empty, ErrorBox, Pagination, Table } from '../components/ui';
import { kindName, statusName, time } from '../lib/display';

export function TasksPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const query = useQuery({
    queryKey: ['tasks', page, status, search],
    queryFn: () =>
      adminApi.tasks(
        new URLSearchParams({
          page: String(page),
          search,
          ...(status ? { status } : {}),
        }).toString(),
      ),
    refetchInterval: 15000,
  });
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
            aria-label="搜索任务"
            placeholder="任务 ID、模型或用户邮箱"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button>搜索</Button>
        </SearchForm>
        <Select
          aria-label="任务状态"
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={[
            { value: '', label: '全部状态' },
            ...['queued', 'submitting', 'generating', 'saving', 'unknown', 'completed', 'failed'].map(
              (value) => ({ value, label: statusName[value] ?? value }),
            ),
          ]}
        />
      </Toolbar>
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Empty>加载中…</Empty>
      ) : query.data?.items.length ? (
        <Table headings={['任务 / 时间', '用户', '类型 / 模型', '状态', '积分 / 结算', '生成结果']}>
          {query.data.items.map((task) => (
            <tr key={task.id}>
              <td>
                <div className="font-mono text-[11px] [overflow-wrap:anywhere]">{task.id}</div>
                <small className="text-fg-muted text-[12px]">{time(task.createdAt)}</small>
              </td>
              <td>
                {task.user.name}
                <small className="text-fg-muted text-[12px]">{task.user.email}</small>
              </td>
              <td>
                {kindName[task.kind]}
                <small className="text-fg-muted text-[12px]">{task.model}</small>
              </td>
              <td>
                <Badge status={task.status} />
              </td>
              <td>
                {task.creditQuote?.total ?? 0} 积分
                <div className="mt-[9px] grid gap-[6px] text-[10px]">
                  {task.settlements.map((hold) => (
                    <span key={hold.id}>
                      <Badge status={hold.status} /> {hold.amount}
                    </span>
                  ))}
                </div>
              </td>
              <td className="min-w-[240px] max-w-[380px] whitespace-normal leading-[1.7]">
                {task.items.map((item, index) => (
                  <details key={item.id}>
                    <summary className="cursor-pointer text-[#b9acec]">
                      结果 {index + 1} · {statusName[item.status] ?? item.status}
                      {item.error ? ' · 查看原因' : ''}
                    </summary>
                    <p className="mt-[9px] text-[#eea4ac]">{item.error ?? '无错误'}</p>
                    <small className="font-mono text-[11px] [overflow-wrap:anywhere] text-fg-muted">
                      供应商任务：{item.providerTaskId ?? '—'}
                    </small>
                  </details>
                ))}
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
