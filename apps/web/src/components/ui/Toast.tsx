import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';

export type ToastType = 'info' | 'success' | 'error' | 'warning';
type ToastEntry = { id: number; message: string; type: ToastType };
const variants = {
  info: {
    icon: Info,
    label: '信息提示',
    className: 'border-white/15 bg-[#292929] text-[#eeeeef]',
    iconClass: 'text-sky-300',
  },
  success: {
    icon: CircleCheck,
    label: '成功提示',
    className: 'border-emerald-400/25 bg-[#1d3029] text-emerald-100',
    iconClass: 'text-emerald-400',
  },
  error: {
    icon: CircleAlert,
    label: '失败提示',
    className: 'border-red-400/30 bg-[#3a2024] text-red-100',
    iconClass: 'text-red-400',
  },
  warning: {
    icon: TriangleAlert,
    label: '警告提示',
    className: 'border-amber-400/30 bg-[#362d1d] text-amber-100',
    iconClass: 'text-amber-400',
  },
};

export function Toast({
  message,
  type = 'info',
  onDismiss,
}: {
  message: string;
  type?: ToastType;
  onDismiss: () => void;
}) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const timer = window.setTimeout(
      () => dismissRef.current(),
      type === 'error' || type === 'warning' ? 4500 : 3000,
    );
    return () => window.clearTimeout(timer);
  }, [message, type]);
  const variant = variants[type];
  const Icon = variant.icon;
  return (
    <div
      role={type === 'error' || type === 'warning' ? 'alert' : 'status'}
      aria-atomic="true"
      data-toast-type={type}
      className={`pointer-events-auto flex w-max max-w-full items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-[0_12px_36px_rgba(0,0,0,0.4)] ${variant.className}`}
    >
      <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${variant.iconClass}`} />
      <span className="sr-only">{variant.label}：</span>
      <span className="min-w-0 whitespace-pre-wrap break-words leading-5">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="关闭提示"
        className="-mr-1 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-current opacity-60 hover:bg-white/10 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function useToastController() {
  const [entries, setEntries] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);
  const dismiss = useCallback(
    (id: number) => setEntries((current) => current.filter((entry) => entry.id !== id)),
    [],
  );
  const show = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++nextId.current;
    setEntries((current) => [...current, { id, message, type }].slice(-4));
    return id;
  }, []);
  const api = useMemo(
    () => ({
      show,
      dismiss,
      info: (message: string) => show(message, 'info'),
      success: (message: string) => show(message, 'success'),
      error: (message: string) => show(message, 'error'),
      warning: (message: string) => show(message, 'warning'),
    }),
    [show, dismiss],
  );
  return { entries, api };
}

const ToastContext = createContext<ReturnType<typeof useToastController>['api'] | null>(null);

function toastHost(): HTMLElement {
  const focusedDialog = document.activeElement?.closest<HTMLDialogElement>('dialog');
  if (focusedDialog?.matches(':modal')) return focusedDialog;
  return (
    Array.from(document.querySelectorAll<HTMLDialogElement>('dialog:modal')).at(-1) ?? document.body
  );
}

function ToastViewport({
  entries,
  dismiss,
}: {
  entries: ToastEntry[];
  dismiss: (id: number) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState(toastHost);
  useLayoutEffect(() => {
    // A popover outside a native modal remains inert. Keep the portal in the active modal,
    // and move it back to the page when the modal closes, preserving queued notifications.
    const observer = new MutationObserver(() => {
      const next = toastHost();
      setHost((current) => (current === next ? current : next));
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    return () => observer.disconnect();
  }, []);
  const latestId = entries[entries.length - 1]?.id;
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    // The native top layer keeps notifications above modal dialogs and fullscreen editors.
    if (typeof element.showPopover === 'function') {
      element.setAttribute('popover', 'manual');
      element.showPopover();
      return () => {
        if (element.isConnected && element.matches(':popover-open')) element.hidePopover();
      };
    }
  }, [latestId, host]);
  return createPortal(
    <div
      ref={viewport}
      data-toaster=""
      aria-label="通知"
      className="pointer-events-none fixed inset-auto left-1/2 top-6 z-[1000] m-0 flex w-max max-w-[calc(100vw-32px)] -translate-x-1/2 flex-col items-center gap-3 overflow-visible border-0 bg-transparent p-0 text-inherit"
    >
      {entries.map((entry) => (
        <Toast
          key={entry.id}
          message={entry.message}
          type={entry.type}
          onDismiss={() => dismiss(entry.id)}
        />
      ))}
    </div>,
    host,
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { entries, api } = useToastController();
  return (
    <ToastContext.Provider value={api}>
      {children}
      {entries.length > 0 && <ToastViewport entries={entries} dismiss={api.dismiss} />}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error('useToast must be used within ToastProvider');
  return toast;
}
