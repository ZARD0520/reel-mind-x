import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Clapperboard, Loader2, LogOut, Plus, User } from 'lucide-react';
import type { AuthSession, Project, User as ReelUser } from '@reel/contracts';
import { ApiError, api } from '../lib/api';

type AuthMode = 'login' | 'register';
type FieldErrors = Partial<Record<'name' | 'email' | 'password', string>>;

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function getAuthErrorMessage(error: unknown, mode: AuthMode): string {
  if (!(error instanceof ApiError)) return '操作失败，请稍后重试';
  if (error.status === 401) return '邮箱或密码不正确，请重新输入';
  if (error.status === 409) return '这个邮箱已经注册，请直接登录';
  if (error.status === 400) return mode === 'register' ? '请检查邮箱、昵称和密码是否符合要求' : '请输入有效的邮箱和密码';
  return '服务暂时不可用，请稍后重试';
}

function getPasswordChecks(password: string) {
  return [
    { label: '超过 10 个字符', passed: password.length > 10 },
    { label: '包含至少 1 个字母', passed: /[A-Za-z]/.test(password) },
    { label: '包含至少 1 个数字', passed: /\d/.test(password) },
  ];
}

function validateAuthForm(mode: AuthMode, values: { name: string; email: string; password: string }): FieldErrors {
  const errors: FieldErrors = {};
  const isValidPassword = getPasswordChecks(values.password).every((item) => item.passed);
  if (mode === 'register' && values.name.trim().length === 0) errors.name = '请输入昵称';
  if (values.email.trim().length === 0) errors.email = '请输入邮箱';
  else if (!isValidEmail(values.email)) errors.email = '请输入正确的邮箱格式';
  if (values.password.length === 0) errors.password = '请输入密码';
  else if (mode === 'register' && !isValidPassword) errors.password = '密码需要超过 10 个字符，并同时包含字母和数字';
  return errors;
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-fg">{label}</span>
      {children}
      <div className="min-h-[18px]">
        {error && (
          <div className="flex items-center gap-1.5 text-xs text-red-300">
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}
      </div>
    </label>
  );
}

function inputClass(hasError: boolean): string {
  return [
    'h-10 rounded-md border bg-input px-3 text-sm outline-none transition-colors placeholder:text-fg-tertiary',
    hasError
      ? 'border-red-400/70 focus:border-red-300 focus:ring-2 focus:ring-red-400/15'
      : 'border-border-subtle focus:border-accent focus:ring-2 focus:ring-accent/15',
  ].join(' ');
}

function Toast({ message }: { message: string }) {
  return (
    <div className="pointer-events-none fixed left-1/2 top-5 z-50 -translate-x-1/2">
      <div className="flex max-w-[calc(100vw-32px)] items-center gap-2 rounded-md border border-red-400/30 bg-[#3a2024] px-4 py-2.5 text-sm text-red-100 shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
        <AlertCircle className="h-4 w-4 shrink-0 text-red-300" />
        <span className="whitespace-nowrap">{message}</span>
      </div>
    </div>
  );
}

function PasswordChecklist({ password }: { password: string }) {
  return (
    <div className="grid gap-2 rounded-md border border-border-subtle bg-base/50 p-3">
      {getPasswordChecks(password).map((item) => (
        <div key={item.label} className={`flex items-center gap-2 text-xs ${item.passed ? 'text-emerald-300' : 'text-fg-secondary'}`}>
          <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${item.passed ? 'border-emerald-400 bg-emerald-400/20' : 'border-border-subtle bg-input'}`}>
            {item.passed && <Check className="h-3 w-3" />}
          </span>
          {item.label}
        </div>
      ))}
    </div>
  );
}

function AuthPanel() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!toastMessage) return undefined;
    const timer = window.setTimeout(() => setToastMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  const auth = useMutation({
    mutationFn: () => mode === 'login'
      ? (api.auth.login({ email, password }) as Promise<AuthSession>)
      : (api.auth.register({ email, password, name }) as Promise<AuthSession>),
    onSuccess: (session) => {
      setFieldErrors({});
      setToastMessage(null);
      qc.setQueryData(['me'], session.user);
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (error) => setToastMessage(getAuthErrorMessage(error, mode)),
  });

  const validateField = (field: keyof FieldErrors) => {
    const nextErrors = validateAuthForm(mode, { name, email, password });
    setFieldErrors((current) => ({ ...current, [field]: nextErrors[field] }));
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    auth.reset();
    setToastMessage(null);
    const nextErrors = validateAuthForm(mode, { name, email, password });
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    auth.mutate();
  };

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setFieldErrors({});
    setToastMessage(null);
    auth.reset();
  };

  return (
    <main className="flex flex-1 items-center justify-center px-6">
      {toastMessage && <Toast message={toastMessage} />}
      <form noValidate onSubmit={onSubmit} className="flex w-full max-w-[380px] flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-6 shadow-[0_16px_48px_rgba(0,0,0,0.25)]">
        <div className="mb-2 space-y-1 text-center">
          <h1 className="text-2xl font-bold">{mode === 'login' ? '登录' : '注册'}</h1>
        </div>

        {mode === 'register' && (
          <Field label="昵称" error={fieldErrors.name}>
            <input value={name} onBlur={() => validateField('name')} onChange={(event) => { setName(event.target.value); setFieldErrors((current) => ({ ...current, name: undefined })); }} className={inputClass(!!fieldErrors.name)} aria-invalid={!!fieldErrors.name} placeholder="例如：ReelMaker" />
          </Field>
        )}

        <Field label="邮箱" error={fieldErrors.email}>
          <input type="email" value={email} onBlur={() => validateField('email')} onChange={(event) => { setEmail(event.target.value); setFieldErrors((current) => ({ ...current, email: undefined })); }} className={inputClass(!!fieldErrors.email)} aria-invalid={!!fieldErrors.email} placeholder="name@example.com" />
        </Field>

        <Field label="密码" error={fieldErrors.password}>
          <input type="password" value={password} onBlur={() => validateField('password')} onChange={(event) => { setPassword(event.target.value); setFieldErrors((current) => ({ ...current, password: undefined })); }} className={inputClass(!!fieldErrors.password)} aria-invalid={!!fieldErrors.password} placeholder={mode === 'register' ? '超过 10 位，包含字母和数字' : '请输入密码'} />
        </Field>

        {mode === 'register' && <PasswordChecklist password={password} />}

        <button type="submit" disabled={auth.isPending} className="mt-2 flex h-10 items-center justify-center gap-2 rounded-md bg-accent font-semibold text-fg transition-colors hover:bg-accent-hover disabled:opacity-60">
          {auth.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === 'login' ? '登录' : '注册'}
        </button>

        <button type="button" onClick={switchMode} className="pt-2 text-sm text-fg-secondary transition-colors hover:text-fg">
          {mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
        </button>
      </form>
    </main>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useQuery<ReelUser>({ queryKey: ['me'], queryFn: () => api.auth.me() as Promise<ReelUser>, retry: false });
  const projects = useQuery<Project[]>({ queryKey: ['projects'], queryFn: () => api.projects.list() as Promise<Project[]>, enabled: !!me.data });
  const createProject = useMutation({
    mutationFn: () => api.projects.create('未命名项目') as Promise<Project>,
    onSuccess: (project) => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/editor/${project.id}`);
    },
  });
  const logout = useMutation({ mutationFn: () => api.auth.logout(), onSuccess: () => { qc.clear(); navigate('/'); } });
  const greeting = useMemo(() => (me.data ? me.data.name || me.data.email : ''), [me.data]);

  if (me.isLoading) {
    return <div className="flex h-full items-center justify-center bg-base text-fg-secondary"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }

  return (
    <div className="flex h-full flex-col bg-base text-fg">
      <header className="flex items-center justify-between border-b border-border-subtle px-8 py-5">
        <button type="button" onClick={() => navigate('/')} className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent"><Clapperboard className="h-[18px] w-[18px]" /></div>
          <span className="text-lg font-bold">ReelMind</span>
        </button>
        {me.data && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-fg-secondary"><User className="h-4 w-4" />{greeting}</div>
            <button type="button" onClick={() => logout.mutate()} className="flex h-9 w-9 items-center justify-center rounded-md bg-elevated hover:bg-input" title="退出登录"><LogOut className="h-4 w-4" /></button>
          </div>
        )}
      </header>

      {isUnauthorized(me.error) ? (
        <AuthPanel />
      ) : (
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-8 py-8">
          <div className="flex items-center justify-between">
            <div><h1 className="text-2xl font-bold">我的剪辑</h1><p className="mt-1 text-sm text-fg-secondary">未导出的剪辑内容会自动保存到当前账号。</p></div>
            <button type="button" onClick={() => createProject.mutate()} disabled={createProject.isPending} className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 font-semibold hover:bg-accent-hover disabled:opacity-60">
              {createProject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}新建剪辑
            </button>
          </div>
          {projects.isLoading ? (
            <div className="flex flex-1 items-center justify-center text-fg-secondary"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (projects.data ?? []).length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border-subtle text-fg-secondary">
              <p>还没有剪辑项目</p>
              <button type="button" onClick={() => createProject.mutate()} className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 font-semibold text-fg hover:bg-accent-hover"><Plus className="h-4 w-4" />新建第一个项目</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {(projects.data ?? []).map((project) => (
                <button key={project.id} type="button" onClick={() => navigate(`/editor/${project.id}`)} className="rounded-lg border border-border-subtle bg-surface p-4 text-left hover:border-accent">
                  <div className="truncate font-semibold">{project.name}</div>
                  <div className="mt-2 text-xs text-fg-secondary">更新于 {new Date(project.updatedAt).toLocaleString()}</div>
                </button>
              ))}
            </div>
          )}
        </main>
      )}
    </div>
  );
}
