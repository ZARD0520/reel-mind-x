import { Input, Button } from '../components/controls';
import { Panel, Toolbar, SearchForm } from '../components/containers';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { adminApi } from '@reel/api-client';
import { Badge, Empty, ErrorBox, Pagination, Table } from '../components/ui';
import { adminListQuery, time } from '../lib/display';

const emptyFilters = { search: '', start: '', end: '' };

export function ProjectsPage() {
  const [page, setPage] = useState(1);
  const [text, setText] = useState('');
  const [filters, setFilters] = useState(emptyFilters);
  const query = useQuery({
    queryKey: ['admin-projects', page, filters],
    queryFn: () => adminApi.projects(adminListQuery(page, filters)),
  });
  const reset = () => {
    setText('');
    setFilters(emptyFilters);
    setPage(1);
  };
  return (
    <Panel>
      <Toolbar>
        <SearchForm
          className="w-full flex-wrap"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setFilters((current) => ({ ...current, search: text.trim() }));
          }}
        >
          <Search size={17} className="shrink-0" />
          <div className="flex min-w-[200px] flex-1">
            <Input
              aria-label="用户名称"
              placeholder="用户昵称"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <Input
            compact
            aria-label="创建时间起"
            type="date"
            className="shrink-0"
            value={filters.start}
            onChange={(event) => {
              setPage(1);
              setFilters((current) => ({ ...current, start: event.target.value }));
            }}
          />
          <span className="shrink-0 text-[#71717f]">—</span>
          <Input
            compact
            aria-label="创建时间止"
            type="date"
            className="shrink-0"
            value={filters.end}
            onChange={(event) => {
              setPage(1);
              setFilters((current) => ({ ...current, end: event.target.value }));
            }}
          />
          <div className="flex w-full justify-end gap-[8px]">
            <Button>查询</Button>
            <Button type="button" onClick={reset}>
              重置
            </Button>
          </div>
        </SearchForm>
      </Toolbar>
      <ErrorBox error={query.error} />
      {query.isPending ? (
        <Empty>加载中…</Empty>
      ) : query.data?.items.length ? (
        <Table headings={['项目', '所属用户', '素材数', '生成任务', '创建时间', '更新时间', '状态']}>
          {query.data.items.map((project) => (
            <tr key={project.id}>
              <td>
                <div className="font-medium text-[#f0f0f4]">{project.name}</div>
                <small className="font-mono text-[11px] [overflow-wrap:anywhere]">
                  {project.id}
                </small>
              </td>
              <td>
                {project.user.name}
                <small className="text-fg-muted text-[12px]">{project.user.email}</small>
              </td>
              <td>{project.assetCount}</td>
              <td>{project.taskCount}</td>
              <td>{time(project.createdAt)}</td>
              <td>{time(project.updatedAt)}</td>
              <td>
                <Badge status={project.deletedAt ? 'deleted' : 'active'} />
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
