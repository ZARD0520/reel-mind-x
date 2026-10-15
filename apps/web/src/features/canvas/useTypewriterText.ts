import { useEffect, useMemo, useState } from 'react';

export function useTypewriterText(text: string, enabled: boolean): string {
  const characters = useMemo(() => [...text], [text]);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled || count >= characters.length) return;
    const remaining = characters.length - count;
    const step = Math.min(8, Math.max(1, Math.floor(remaining / 40)));
    const timer = window.setTimeout(() => setCount((current) => Math.min(characters.length, current + step)), 18);
    return () => window.clearTimeout(timer);
  }, [characters.length, count, enabled]);

  return enabled ? characters.slice(0, count).join('') : text;
}
