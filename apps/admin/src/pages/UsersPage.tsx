import { Input, Button } from '../components/controls';
import { Panel, Toolbar, SearchForm } from '../components/containers';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import type { AdminUser } from '@reel/contracts';
import { AdjustmentDialog } from '../features/users/AdjustmentDialog';
import { adminApi } from '@reel/api-client';
import { Badge, Empty, ErrorBox, Pagination, Table } from '../components/ui';
import { time, number } from '../lib/display';

export function UsersPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const query = useQuery({
    queryKey: ['users', page, search],
    queryFn: () => adminApi.users(new URLSearchParams({ page: String(page), search }).toString()),
  });
  const status = useMutation({
    mutationFn: (user: AdminUser) =>
      adminApi.userStatus(user.id, user.status === 'active' ? 'disabled' : 'active'),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['users'] });
    },
  });
  return (
    <Panel>
      <Toolbar>
        <SearchForm
          className="w-[min(100%,470px)]"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setSearch(text.trim());
          }}
        >
          <Search size={17} />
          <Input
            aria-label="搜索用户"
            placeholder="搜索用户邮箱或昵称"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button>搜索</Button>
        </SearchForm>
      </Toolbar>
      <ErrorBox error={query.error ?? status.error} />
      {query.isPending ? (
        <Empty>加载中…</Empty>
      ) : query.data?.items.length ? (
        <Table headings={['用户', '状态', '可用积分', '冻结积分', '累计消耗', '注册时间', '操作']}>
          {query.data.items.map((user) => (
            <tr key={user.id}>
              <td>
                <div className="font-medium text-[#f0f0f4]">
                  {user.name}{' '}
                  {user.role === 'admin' && (
                    <span className="ml-[5px] rounded-[4px] bg-[#b3a5fb14] px-[5px] py-[3px] text-[9px] text-[#c7b8ff]">
                      管理员
                    </span>
                  )}
                </div>
                <small className="text-fg-muted text-[12px]">{user.email}</small>
              </td>
              <td>
                <Badge status={user.status} />
              </td>
              <td>
                {user.creditAccount ? (
                  number(user.creditAccount.available)
                ) : (
                  <span className="text-fg-muted">未开通</span>
                )}
              </td>
              <td>{number(user.creditAccount?.frozen ?? 0)}</td>
              <td>{number(user.creditAccount?.spent ?? 0)}</td>
              <td>{time(user.createdAt)}</td>
              <td>
                <div className="flex gap-[7px]">
                  <Button variant="ghost" size="small" onClick={() => setSelected(user)}>
                    调整积分
                  </Button>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => navigate(`/ledger?userId=${encodeURIComponent(user.id)}`)}
                  >
                    流水
                  </Button>
                  {user.role !== 'admin' && (
                    <Button
                      variant="ghost"
                      size="small"
                      danger={user.status === 'active'}
                      disabled={status.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `确认${user.status === 'active' ? '禁用' : '启用'} ${user.email}？`,
                          )
                        )
                          status.mutate(user);
                      }}
                    >
                      {user.status === 'active' ? '禁用' : '启用'}
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty />
      )}
      <Pagination data={query.data} page={page} setPage={setPage} />
      {selected && <AdjustmentDialog user={selected} close={() => setSelected(null)} />}
    </Panel>
  );
}
