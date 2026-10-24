import type { ReactNode } from 'react';
import type { PageResult } from '@reel/contracts';
import { number, statusName } from '../lib/display';
import { Button } from './controls';

export function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <div
      className="my-[12px] rounded-[7px] border border-[#e85b6a45] bg-[#e85b6a12] px-[15px] py-[12px] leading-[1.6] text-[#ffb1b9]"
      role="alert"
    >
      {error instanceof Error ? error.message : '请求失败，请重试'}
    </div>
  ) : null;
}

const badgeColors: Record<string, string> = {
  active: 'bg-[#5ac99012] text-[#8adbb5]',
  completed: 'bg-[#5ac99012] text-[#8adbb5]',
  captured: 'bg-[#5ac99012] text-[#8adbb5]',
  ready: 'bg-[#5ac99012] text-[#8adbb5]',
  failed: 'bg-[#ec657312] text-[#efa1a8]',
  disabled: 'bg-[#ec657312] text-[#efa1a8]',
  deleted: 'bg-[#ec657312] text-[#efa1a8]',
  held: 'bg-[#c99a4016] text-[#e9c780]',
  unknown: 'bg-[#c99a4016] text-[#e9c780]',
  refunded: 'bg-[#7292f015] text-[#a9bffa]',
};
export function Badge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-[5px] px-[7px] py-[4px] text-[10px] ${badgeColors[status] ?? 'bg-[#ffffff09] text-[#b3b3c1]'}`}
    >
      {statusName[status] ?? status}
    </span>
  );
}
export function Empty({ children = '暂无记录' }: { children?: ReactNode }) {
  return <div className="px-[20px] py-[65px] text-center text-[#92929f]">{children}</div>;
}
export function Table({ headings, children }: { headings: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left whitespace-nowrap">
        <thead>
          <tr>
            {headings.map((heading) => (
              <th
                key={heading}
                className="border-y border-border bg-[#202027] px-[21px] py-[13px] text-[11px] font-medium text-[#858593]"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-[12px] text-[#b9b9c5] [&_td]:border-b [&_td]:border-[#2a2a33] [&_td]:px-[21px] [&_td]:py-[18px] [&_td]:align-top [&_tr:last-child_td]:border-b-0 [&_tr:hover]:bg-[#ffffff02] [&_td_small]:mt-[5px] [&_td_small]:block">
          {children}
        </tbody>
      </table>
    </div>
  );
}
export function Pagination({
  data,
  page,
  setPage,
}: {
  data?: Pick<PageResult<unknown>, 'total' | 'pageSize'>;
  page: number;
  setPage: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-border px-[22px] py-[16px] text-[11px] text-[#848491] max-[760px]:p-[14px]">
      <span>共 {number(data?.total ?? 0)} 条</span>
      <div className="flex items-center gap-[15px]">
        <Button size="pagination" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          上一页
        </Button>
        <span>
          {page} / {Math.max(1, Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 20)))}
        </span>
        <Button
          size="pagination"
          disabled={!data || page * data.pageSize >= data.total}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}
