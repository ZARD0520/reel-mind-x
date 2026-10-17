import { useEffect, useRef } from 'react';

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    const timer = window.setTimeout(() => dismissRef.current(), 3500);
    return () => window.clearTimeout(timer);
  }, [message]);
  return <div ref={(element) => {
    if (!element) return;
    element.setAttribute('popover', 'manual');
    if (!element.matches(':popover-open')) element.showPopover();
  }} role="alert" className="fixed bottom-8 left-1/2 top-auto m-0 w-max max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-xl border border-white/10 bg-[#292929] px-4 py-3 text-sm text-white shadow-xl">{message}</div>;
}
