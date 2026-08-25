import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, ArrowUp, Check, Clapperboard, Loader2, LogOut, Mic, Plus, Trash2, User, X } from 'lucide-react';
import type { AuthSession, Canvas, User as ReelUser } from '@reel/contracts';
import { ApiError, api } from '../lib/api';
import { ModelSelect, type ModelId } from '../features/home/components/ModelSelect';

type AuthMode = 'login' | 'register';
type FieldErrors = Partial<Record<'name' | 'email' | 'password', string>>;

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

function getCanvasErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return '操作失败，请稍后重试';
  if (error.status === 401) return '登录已过期，请重新登录';
  return '操作失败，请稍后重试';
}

function formatEditedAt(value: Date | string): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (elapsed < minute) return '编辑于刚刚';
  if (elapsed < hour) return `编辑于 ${Math.floor(elapsed / minute)} 分钟前`;
  if (elapsed < day) return `编辑于 ${Math.floor(elapsed / hour)} 小时前`;
  if (elapsed < 30 * day) return `编辑于 ${Math.floor(elapsed / day)} 天前`;
  if (elapsed < 365 * day) return `编辑于 ${Math.floor(elapsed / (30 * day))} 个月前`;
  return `编辑于 ${Math.floor(elapsed / (365 * day))} 年前`;
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

function DeleteCanvasDialog({
  canvas,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  canvas: Canvas;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm">
      <section className="w-full max-w-[420px] rounded-lg border border-border-subtle bg-surface p-5 shadow-[0_24px_72px_rgba(0,0,0,0.45)]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-red-500/12 text-red-300">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-fg">删除工作流</h2>
              <p className="mt-2 text-sm leading-6 text-fg-secondary">
                确定删除「<span className="font-medium text-fg">{canvas.name}</span>」吗？该操作无法撤销。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-secondary transition-colors hover:bg-input hover:text-fg disabled:opacity-50"
            title="取消"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="h-9 rounded-md border border-border-subtle px-4 text-sm font-medium text-fg-secondary transition-colors hover:bg-input hover:text-fg disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex h-9 items-center gap-2 rounded-md bg-red-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-400 disabled:opacity-60"
          >
            {isDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
            删除
          </button>
        </div>
      </section>
    </div>
  );
}

function AuthPanel({ onClose, onAuthenticated }: { onClose: () => void; onAuthenticated: () => void }) {
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
      void qc.invalidateQueries({ queryKey: ['canvases'] });
      onAuthenticated();
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-6 backdrop-blur-md" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      {toastMessage && <Toast message={toastMessage} />}
      <form noValidate onSubmit={onSubmit} className="relative flex w-full max-w-[380px] flex-col gap-2 rounded-xl border border-white/[0.12] bg-[#171717] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
        <button type="button" onClick={onClose} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-fg-secondary transition-colors hover:bg-white/[0.08] hover:text-fg" aria-label="关闭登录窗口">
          <X className="h-4 w-4" />
        </button>
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
    </div>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const activeView = location.pathname === '/project' ? 'workspace' : 'home';
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState<ModelId>('glm-4-flash');
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [canvasPendingDeletion, setCanvasPendingDeletion] = useState<Canvas | null>(null);
  const me = useQuery<ReelUser>({ queryKey: ['me'], queryFn: () => api.auth.me() as Promise<ReelUser>, retry: false });
  const canvases = useQuery<Canvas[]>({ queryKey: ['canvases'], queryFn: () => api.canvases.list() as Promise<Canvas[]>, enabled: !!me.data });

  useEffect(() => {
    if (!toastMessage) return undefined;
    const timer = window.setTimeout(() => setToastMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  const createCanvas = useMutation({
    mutationFn: (name?: string) => {
      return api.canvases.create(name) as Promise<Canvas>;
    },
    onSuccess: (canvas) => {
      setToastMessage(null);
      void qc.invalidateQueries({ queryKey: ['canvases'] });
      navigate(`/canvas/${canvas.id}`);
    },
    onError: (error) => setToastMessage(getCanvasErrorMessage(error)),
  });
  const removeCanvas = useMutation({
    mutationFn: (id: string) => api.canvases.remove(id),
    onSuccess: () => {
      setToastMessage(null);
      setCanvasPendingDeletion(null);
      void qc.invalidateQueries({ queryKey: ['canvases'] });
    },
    onError: (error) => setToastMessage(getCanvasErrorMessage(error)),
  });
  const logout = useMutation({ mutationFn: () => api.auth.logout(), onSuccess: () => { qc.clear(); navigate('/'); } });
  const greeting = useMemo(() => (me.data ? me.data.name || me.data.email : ''), [me.data]);

  const handleCreateCanvas = (name?: string) => {
    if (!me.data) {
      setIsAuthOpen(true);
      return;
    }
    createCanvas.mutate(name);
  };

  const handlePromptSubmit = () => {
    const value = prompt.trim();
    if (!value || createCanvas.isPending) return;
    const canvasName = value.length > 32 ? `${value.slice(0, 32)}…` : value;
    handleCreateCanvas(canvasName);
  };

  const handleRemoveCanvas = (canvas: Canvas) => {
    setCanvasPendingDeletion(canvas);
  };

  const confirmRemoveCanvas = () => {
    if (!canvasPendingDeletion) return;
    removeCanvas.mutate(canvasPendingDeletion.id);
  };

  return (
    <div className="flex h-full flex-col bg-base text-fg">
      {toastMessage && <Toast message={toastMessage} />}
      {isAuthOpen && <AuthPanel onClose={() => setIsAuthOpen(false)} onAuthenticated={() => setIsAuthOpen(false)} />}
      {canvasPendingDeletion && (
        <DeleteCanvasDialog
          canvas={canvasPendingDeletion}
          isDeleting={removeCanvas.isPending}
          onCancel={() => setCanvasPendingDeletion(null)}
          onConfirm={confirmRemoveCanvas}
        />
      )}
      <header className="relative z-20 grid h-[72px] shrink-0 grid-cols-[1fr_auto_1fr] items-center bg-[#050505] px-5 sm:px-8 lg:px-12">
        <button type="button" onClick={() => navigate('/')} className="flex w-fit items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f7f7f2] text-[#050505]"><Clapperboard className="h-[18px] w-[18px]" /></div>
          <span className="hidden text-[19px] font-bold tracking-[-0.02em] text-[#f7f7f2] sm:inline">ReelMindX</span>
        </button>
        <nav className="flex h-[42px] items-center gap-1 rounded-lg border border-white/[0.09] bg-white/[0.055] p-1" aria-label="主导航">
            <button
              type="button"
              onClick={() => navigate('/')}
              className={`h-[34px] min-w-[92px] rounded-md px-4 text-sm transition-colors sm:min-w-[118px] ${activeView === 'home' ? 'bg-white/[0.10] font-semibold text-[#f7f7f2]' : 'font-medium text-[#b9b9ba] hover:text-[#f7f7f2]'}`}
            >
              主页
            </button>
            <button
              type="button"
              onClick={() => navigate('/project')}
              className={`h-[34px] min-w-[92px] rounded-md px-4 text-sm transition-colors sm:min-w-[118px] ${activeView === 'workspace' ? 'bg-white/[0.10] font-semibold text-[#f7f7f2]' : 'font-medium text-[#b9b9ba] hover:text-[#f7f7f2]'}`}
            >
              工作空间
            </button>
          </nav>
        {me.data ? (
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setIsUserMenuOpen((open) => !open)}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.06] text-[#b9b9ba] transition-colors hover:bg-white/[0.10] hover:text-[#f7f7f2]"
              aria-label="打开用户菜单"
              aria-expanded={isUserMenuOpen}
            >
              <User className="h-[18px] w-[18px]" />
            </button>
            {isUserMenuOpen && (
              <div className="absolute right-0 top-12 w-52 rounded-xl border border-white/[0.12] bg-[#171717] p-2 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
                <div className="truncate px-3 py-2 text-sm text-[#b9b9ba]">{greeting}</div>
                <button type="button" onClick={() => logout.mutate()} className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm text-[#b9b9ba] transition-colors hover:bg-white/[0.08] hover:text-[#f7f7f2]">
                  <LogOut className="h-4 w-4" />退出登录
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="ml-auto flex items-center">
            <button
              type="button"
              onClick={() => setIsAuthOpen(true)}
              disabled={me.isLoading}
              className="flex h-9 items-center justify-center rounded-lg border border-white/[0.12] bg-white/[0.06] px-4 text-sm font-semibold text-[#f7f7f2] transition-colors hover:bg-white/[0.11] disabled:opacity-60"
            >
              {me.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '登录'}
            </button>
          </div>
        )}
      </header>

      {activeView === 'home' ? (
        <main className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#050505] px-5 pb-24 sm:px-8">
          <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_center,rgba(255,255,255,0.07)_0,rgba(255,255,255,0)_52%)]" />
          <div className="relative flex w-full max-w-[760px] -translate-y-5 flex-col items-center gap-[26px]">
            <h1 className="text-center text-[30px] font-bold leading-tight tracking-[-0.035em] text-[#f7f7f2] sm:text-4xl">你想生成什么素材？</h1>
            <form
              onSubmit={(event) => { event.preventDefault(); handlePromptSubmit(); }}
              className="w-full rounded-2xl border border-white/[0.14] bg-[#1c1c1c] p-3 shadow-[0_28px_90px_rgba(0,0,0,0.62)] transition-colors focus-within:border-white/[0.24] sm:p-4"
            >
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handlePromptSubmit();
                  }
                }}
                rows={3}
                className="block min-h-[88px] w-full resize-none bg-transparent px-1 py-1 text-[15px] leading-6 text-[#f7f7f2] outline-none placeholder:text-[#8e8e92] sm:px-1.5"
                placeholder="描述你的素材需求，例如：为一款 AI 剪辑产品生成小红书竖版广告，黑色高级感，突出自动生成脚本和视频素材。"
                aria-label="描述你的素材需求"
              />
              <div className="mt-1 flex items-center justify-end gap-2">
                <ModelSelect value={selectedModel} onChange={setSelectedModel} />
                <button type="button" disabled className="flex h-9 w-9 items-center justify-center rounded-full text-[#b9b9ba] opacity-75" title="语音输入即将支持" aria-label="语音输入即将支持">
                  <Mic className="h-[17px] w-[17px]" />
                </button>
                <button
                  type="submit"
                  disabled={!prompt.trim() || createCanvas.isPending}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f7f7f2] text-[#090909] transition-all hover:scale-[1.03] hover:bg-white active:scale-95 disabled:cursor-not-allowed disabled:bg-white/[0.12] disabled:text-white/35"
                  title="创建工作流"
                  aria-label="发送"
                >
                  {createCanvas.isPending ? <Loader2 className="h-[17px] w-[17px] animate-spin" /> : <ArrowUp className="h-[18px] w-[18px] stroke-[2.4]" />}
                </button>
              </div>
            </form>
          </div>
        </main>
      ) : !me.data ? (
        <main className="relative flex min-h-0 flex-1 items-center justify-center bg-[#050505] px-5 pb-16 sm:px-8">
          <button
            type="button"
            onClick={() => setIsAuthOpen(true)}
            className="absolute right-5 top-6 flex h-10 items-center gap-2 rounded-xl bg-white/[0.10] px-4 text-sm font-semibold text-[#f7f7f2] transition-colors hover:bg-white/[0.15] sm:right-8 lg:right-12"
          >
            <Plus className="h-4 w-4" />
            新建项目
          </button>

          <div className="flex -translate-y-4 flex-col items-center text-center">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.12] text-[#8b8b8f]">
              <User className="h-8 w-8 stroke-[1.6]" />
            </div>
            <h1 className="text-xl font-semibold tracking-[-0.02em] text-[#f7f7f2]">尚未登录</h1>
            <p className="mt-3 text-[15px] text-[#7b7b80]">请先登录来开启 Flow 旅程</p>
            <button
              type="button"
              onClick={() => setIsAuthOpen(true)}
              className="mt-4 h-10 rounded-xl border border-white/[0.16] px-5 text-sm font-semibold text-[#f7f7f2] transition-colors hover:bg-white/[0.08]"
            >
              登录以开始使用
            </button>
          </div>
        </main>
      ) : (
        <main className="reel-scroll min-h-0 w-full flex-1 overflow-y-auto bg-[#050505] px-5 py-8 sm:px-8 lg:px-12">
          <div className="mb-6 flex h-10 items-center justify-end">
            <button
              type="button"
              onClick={() => handleCreateCanvas()}
              disabled={createCanvas.isPending}
              className="flex h-10 items-center gap-2 rounded-xl bg-white/[0.10] px-4 text-sm font-semibold text-[#f7f7f2] transition-colors hover:bg-white/[0.15] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {createCanvas.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              新建项目
            </button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,260px))] gap-4">
            <button
              type="button"
              onClick={() => handleCreateCanvas()}
              disabled={createCanvas.isPending}
              className="group flex aspect-[1.06] w-full flex-col items-center justify-center gap-4 rounded-[18px] border border-white/[0.14] bg-[#202020] text-[#f7f7f2] transition-all hover:border-white/[0.24] hover:bg-[#242424] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#f7f7f2] text-[#151515] transition-transform duration-200 ease-out group-hover:scale-110 group-active:scale-100">
                {createCanvas.isPending ? <Loader2 className="h-6 w-6 animate-spin" /> : <Plus className="h-7 w-7 stroke-[2]" />}
              </span>
              <span className="text-[13px] font-semibold">新建项目</span>
            </button>

            {canvases.isLoading
              ? Array.from({ length: 2 }, (_, index) => (
                  <div key={index} className="aspect-[1.06] w-full animate-pulse rounded-[18px] border border-white/[0.10] bg-[#202020] p-3">
                    <div className="h-[72%] rounded-[17px] bg-white/[0.05]" />
                    <div className="mt-4 h-5 w-2/3 rounded bg-white/[0.06]" />
                    <div className="mt-3 h-4 w-1/3 rounded bg-white/[0.04]" />
                  </div>
                ))
              : (canvases.data ?? []).map((canvas) => (
                  <article key={canvas.id} className="group relative aspect-[1.06] w-full overflow-hidden rounded-[18px] border border-white/[0.14] bg-[#202020] transition-colors hover:border-white/[0.24]">
                    <button type="button" onClick={() => navigate(`/canvas/${canvas.id}`)} className="flex h-full w-full flex-col p-3 text-left">
                      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[17px] bg-[#071219]">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_20%,rgba(19,180,231,0.34),transparent_38%),linear-gradient(120deg,#050708_5%,#0d2630_55%,#071116_100%)]" />
                        <div className="absolute inset-0 opacity-35 [background-image:repeating-linear-gradient(90deg,transparent_0,transparent_16px,rgba(255,255,255,0.08)_18px,transparent_22px)]" />
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                          <Clapperboard className="mb-3 h-9 w-9 text-white/75" />
                          <span className="max-w-[80%] truncate text-base font-bold tracking-[0.08em] text-white/90">REELMIND X</span>
                        </div>
                      </div>
                      <div className="shrink-0 px-1 pb-1 pt-4">
                        <h2 className="truncate text-lg font-semibold tracking-[-0.02em] text-[#f7f7f2]">{canvas.name}</h2>
                        <p className="mt-2 text-sm font-medium text-[#77777b]">{formatEditedAt(canvas.updatedAt)}</p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveCanvas(canvas)}
                      disabled={removeCanvas.isPending}
                      className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white/65 opacity-0 backdrop-blur-sm transition-all hover:bg-red-500/80 hover:text-white group-hover:opacity-100 focus:opacity-100 disabled:opacity-40"
                      title="删除项目"
                      aria-label={`删除项目 ${canvas.name}`}
                    >
                      {removeCanvas.isPending && removeCanvas.variables === canvas.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </article>
                ))}
          </div>
        </main>
      )}
    </div>
  );
}
