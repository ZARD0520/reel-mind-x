import { Button, Field, Input } from '../components/controls';
import { LoginShell, LoginCard, BrandMark } from '../components/containers';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { adminApi, HttpError } from '@reel/api-client';
import { Empty, ErrorBox } from '../components/ui';
import { useAdminSession } from '../app/session';

export function LoginPage() {
  const session = useAdminSession();
  const location = useLocation();
  const denied = !!session.data && session.data.role !== 'admin';
  const client = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => adminApi.login(email, password),
    onSuccess: () => {
      setPassword('');
      void client.invalidateQueries({ queryKey: ['session'] });
    },
  });
  const logout = useMutation({
    mutationFn: adminApi.logout,
    onSuccess: () => {
      client.clear();
      void client.invalidateQueries();
    },
  });
  if (session.isPending)
    return (
      <LoginShell>
        <Empty>正在验证登录状态…</Empty>
      </LoginShell>
    );
  if (session.data?.role === 'admin') {
    const from = (location.state as { from?: string } | null)?.from;
    return (
      <Navigate
        to={
          from?.startsWith('/') && !from.startsWith('//') && from !== '/login' ? from : '/overview'
        }
        replace
      />
    );
  }
  if (session.error && !(session.error instanceof HttpError && session.error.status === 401))
    return (
      <LoginShell>
        <LoginCard>
          <ErrorBox error={session.error} />
          <Button onClick={() => void session.refetch()}>重新连接</Button>
        </LoginCard>
      </LoginShell>
    );
  return (
    <LoginShell>
      <LoginCard>
        <div className="mb-[23px] flex items-center gap-[13px]">
          <BrandMark large>
            <ShieldCheck size={26} />
          </BrandMark>
          <h1 className="text-[25px] font-bold tracking-[-0.6px] max-[760px]:text-[22px]">
            ReelMindX <span>Admin</span>
          </h1>
        </div>
        <p className="text-fg-muted">创作平台管理控制台</p>
        {denied ? (
          <>
            <div
              className="my-[12px] rounded-[7px] border border-[#e85b6a45] bg-[#e85b6a12] px-[15px] py-[12px] leading-[1.6] text-[#ffb1b9]"
              role="alert"
            >
              当前账号没有管理员权限，请使用管理员账号登录。
            </div>
            <Button
              variant="primary"
              className="mt-[12px] w-full"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              退出当前账号
            </Button>
            <ErrorBox error={logout.error} />
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              login.mutate();
            }}
          >
            <Field>
              管理员邮箱
              <Input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="admin@example.com"
              />
            </Field>
            <Field>
              密码
              <Input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <ErrorBox error={login.error} />
            <Button variant="primary" className="mt-[12px] w-full" disabled={login.isPending}>
              {login.isPending ? '登录中…' : '登录管理后台'}
            </Button>
          </form>
        )}
        <small className="text-fg-muted text-[12px]">使用已授权的创作台账号登录</small>
      </LoginCard>
    </LoginShell>
  );
}
