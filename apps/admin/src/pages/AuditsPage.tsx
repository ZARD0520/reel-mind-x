import { Panel } from '../components/containers';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@reel/api-client';
import { Empty, ErrorBox, Pagination, Table } from '../components/ui';
import { time } from '../lib/display';

export function AuditsPage() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['audits', page],
    queryFn: () => adminApi.audits(`page=${page}`),
  });
  const names: Record<string, string> = {
    'admin.grant': '授予管理员',
    'user.status': '调整账号状态',
    'credits.adjust': '调整积分',
    'pricing.save': '修改定价',
    'settings.save': '修改额度与上限',
  };
  return (
    <Panel>
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Empty>加载中…</Empty>
      ) : query.data?.items.length ? (
        <Table headings={['时间', '操作人 ID', '操作', '对象 ID', '详情']}>
          {query.data.items.map((row) => (
            <tr key={row.id}>
              <td>{time(row.createdAt)}</td>
              <td className="font-mono text-[11px] [overflow-wrap:anywhere]">{row.actorId}</td>
              <td>{names[row.action] ?? row.action}</td>
              <td className="font-mono text-[11px] [overflow-wrap:anywhere]">{row.targetId}</td>
              <td>
                <details>
                  <summary className="cursor-pointer text-[#b9acec]">查看变更</summary>
                  <pre className="max-h-[260px] max-w-[450px] overflow-auto rounded-[5px] bg-input p-[12px] text-[11px] leading-[1.7] whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {JSON.stringify(row.detail, null, 2)}
                  </pre>
                </details>
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
