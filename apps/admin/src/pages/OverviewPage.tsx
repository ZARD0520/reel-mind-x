import { Panel, PanelHeading } from '../components/containers';
import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowDownLeft, Coins, Users } from 'lucide-react';
import { adminApi } from '@reel/api-client';
import { Empty, ErrorBox, Table } from '../components/ui';
import { kindName, number } from '../lib/display';

export function OverviewPage() {
  const query = useQuery({
    queryKey: ['overview'],
    queryFn: adminApi.overview,
    refetchInterval: 30000,
  });
  const data = query.data;
  if (query.isPending) return <Empty>正在加载统计…</Empty>;
  if (!data) return <ErrorBox error={query.error} />;
  const cards = [
    { label: '用户总数', value: data.users, note: '平台已注册用户', icon: Users },
    { label: '生成任务', value: data.tasks, note: `${data.active} 个任务处理中`, icon: Activity },
    { label: '已消耗积分', value: data.spent, note: '成功结算的累计积分', icon: ArrowDownLeft },
    { label: '冻结积分', value: data.frozen, note: '待结算，失败自动退还', icon: Coins },
  ];
  return (
    <>
      <div className="mb-[25px] grid grid-cols-4 gap-[18px] max-[1150px]:grid-cols-2 max-[760px]:gap-[10px]">
        {cards.map((card) => (
          <section
            className="rounded-[10px] border border-border bg-surface p-[21px] max-[760px]:p-[16px]"
            key={card.label}
          >
            <div className="flex items-center justify-between text-[12px] text-[#a0a0ad] [&_svg]:text-[#b1a1f1]">
              {card.label}
              <card.icon size={18} />
            </div>
            <strong className="mt-[17px] mb-[12px] block text-[31px] font-[550] tracking-[-1px] max-[760px]:text-[27px]">
              {number(card.value)}
            </strong>
            <small className="text-[11px] text-[#747482]">{card.note}</small>
          </section>
        ))}
      </div>
      <Panel>
        <PanelHeading>
          <div>
            <h2 className="text-[15px] font-semibold">模型使用情况</h2>
            <p>累计生成任务与已结算积分</p>
          </div>
          <span className="text-fg-muted">
            成功 {data.completed} · 失败 {data.failed}
          </span>
        </PanelHeading>
        {data.models.length ? (
          <Table headings={['模型', '类型', '任务数', '成功 / 失败', '成功率', '消耗积分']}>
            {data.models.map((row) => (
              <tr key={`${row.kind}/${row.model}`}>
                <td className="font-medium text-[#f0f0f4]">{row.model}</td>
                <td>{kindName[row.kind]}</td>
                <td>{number(row.tasks)}</td>
                <td>
                  {row.completed} / {row.failed}
                </td>
                <td>
                  {row.completed + row.failed
                    ? `${Math.round((row.completed / (row.completed + row.failed)) * 100)}%`
                    : '—'}
                </td>
                <td>{number(row.spent)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty />
        )}
      </Panel>
    </>
  );
}
