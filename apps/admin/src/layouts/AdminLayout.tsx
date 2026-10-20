import { Button } from '../components/controls';
import { LoginShell, LoginCard, BrandMark } from '../components/containers';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { adminApi, HttpError } from '@reel/api-client';
import { Empty, ErrorBox } from '../components/ui';
import { adminNavigation } from '../app/navigation';
import { useAdminSession } from '../app/session';

export function AdminLayout() {
  const client = useQueryClient();
  const session = useAdminSession();
  const location = useLocation();
  const navigate = useNavigate();
  const active = adminNavigation.find((item) => item.path === location.pathname);
  const logout = useMutation({
    mutationFn: adminApi.logout,
    onSuccess: () => {
      client.clear();
      navigate('/login', { replace: true });
      void client.invalidateQueries();
    },
  });
  if (session.isPending)
    return (
      <LoginShell>
        <Empty>正在验证登录状态…</Empty>
      </LoginShell>
    );
  if (
    !session.data &&
    session.error &&
    !(session.error instanceof HttpError && session.error.status === 401)
  )
    return (
      <LoginShell>
        <LoginCard>
          <ErrorBox error={session.error} />
          <Button onClick={() => void session.refetch()}>重新连接</Button>
        </LoginCard>
      </LoginShell>
    );
  if (!session.data || session.data.role !== 'admin')
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search + location.hash }}
      />
    );
  return (
    <div className="flex min-h-screen max-[760px]:block">
      <aside className="fixed inset-y-0 left-0 flex w-[226px] flex-col border-r border-[#2a2a33] bg-[#17171d] px-[17px] pt-[29px] pb-[18px] max-[1150px]:w-[200px] max-[760px]:static max-[760px]:w-full max-[760px]:p-[17px]">
        <Link
          className="flex items-center gap-[11px] px-[9px] text-[18px] font-[650] max-[760px]:text-[16px]"
          to="/overview"
        >
          <BrandMark>
            <ShieldCheck size={21} />
          </BrandMark>
          <span>
            ReelMindX
            <small className="mt-[5px] block text-[10px] font-normal tracking-[2px] text-[#878793] max-[760px]:hidden">
              管理控制台
            </small>
          </span>
        </Link>
        <span className="mx-[13px] mt-[43px] mb-[14px] text-[10px] tracking-[1px] text-[#71717f] max-[760px]:hidden">
          工作空间
        </span>
        <nav className="grid gap-[7px] max-[760px]:mt-[18px] max-[760px]:flex max-[760px]:gap-[5px] max-[760px]:overflow-auto">
          {adminNavigation.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                [
                  'flex items-center gap-[12px] rounded-[7px] px-[13px] py-[12px] text-[13px] max-[760px]:p-[9px] max-[760px]:text-[11px] max-[760px]:whitespace-nowrap max-[760px]:[&_svg]:w-[15px]',
                  isActive
                    ? 'bg-[#b3a5fb16] text-accent-hover [&_svg]:text-[#baaaff]'
                    : 'text-[#9e9eac] hover:bg-[#ffffff08] hover:text-[#e8e8ef]',
                ].join(' ')
              }
            >
              <item.icon size={18} />
              {item.title}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-[10px] border-t border-border px-[4px] pt-[18px] max-[760px]:hidden [&>div]:min-w-0 [&>div]:flex-1">
          <span className="grid size-[33px] place-items-center rounded-full bg-[#343040] text-[#c5b6f9]">
            {session.data.name.slice(0, 1)}
          </span>
          <div>
            <strong className="block truncate text-[12px]">{session.data.name}</strong>
            <small className="mt-[5px] block text-[10px] text-[#82828f]">管理员</small>
          </div>
          <Button
            variant="icon"
            size="icon"
            aria-label="退出登录"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            <LogOut size={17} />
          </Button>
        </div>
      </aside>
      <main className="ml-[226px] min-w-0 w-[calc(100%-226px)] px-[38px] py-[35px] min-[1700px]:px-[60px] min-[1700px]:py-[40px] max-[1150px]:ml-[200px] max-[1150px]:w-[calc(100%-200px)] max-[1150px]:px-[22px] max-[1150px]:py-[26px] max-[760px]:m-0 max-[760px]:w-full max-[760px]:px-[15px] max-[760px]:py-[24px]">
        <header className="mb-[30px] flex items-center justify-between gap-[20px] [&>button]:text-[12px]">
          <div>
            <div className="mb-[13px] text-[11px] text-[#82828f]">管理控制台 / {active?.title}</div>
            <h1 className="text-[25px] font-bold tracking-[-0.6px] max-[760px]:text-[22px]">
              {active?.title}
            </h1>
          </div>
          <Button variant="ghost" onClick={() => void client.invalidateQueries()}>
            <RefreshCw size={15} />
            刷新数据
          </Button>
        </header>
        <ErrorBox error={logout.error} />
        <Outlet />
      </main>
    </div>
  );
}
