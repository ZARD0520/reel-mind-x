import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Copy, ClipboardPaste, TextSelect } from 'lucide-react';
import { useToast } from '../../../components/ui/Toast';

type MenuState = { x: number; y: number; range: Range; text: string };

export function usePromptEditMenu(input: RefObject<HTMLDivElement>, disabled?: boolean) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (!menu) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenu(null);
    };
    const close = () => setMenu(null);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  function open(event: MouseEvent) {
    const element = input.current;
    if (!element) return;
    const selection = window.getSelection();
    let range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    if (!range || !element.contains(range.startContainer) || !element.contains(range.endContainer)) {
      range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
    }
    setMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 168)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 132)),
      range,
      text: range.collapsed ? '' : range.toString(),
    });
  }

  function restoreSelection(range: Range) {
    if (!input.current?.isConnected || !input.current.contains(range.commonAncestorContainer)) return false;
    input.current.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  }

  async function copy() {
    if (!menu?.text) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(menu.text);
      else if (!restoreSelection(menu.range) || !document.execCommand('copy')) throw new Error('copy');
    } catch { toast.error('复制失败，请使用 Ctrl+C 重试'); }
    setMenu(null);
  }

  async function paste() {
    if (!menu || disabled) return;
    const range = menu.range.cloneRange();
    setMenu(null);
    try {
      const text = await navigator.clipboard.readText();
      if (restoreSelection(range)) document.execCommand('insertText', false, text);
    } catch { toast.error('无法读取剪贴板，请使用 Ctrl+V 粘贴'); }
  }

  function selectAll() {
    if (!input.current) return;
    const range = document.createRange();
    range.selectNodeContents(input.current);
    restoreSelection(range);
    setMenu(null);
  }

  const buttonClass = 'flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-[#dddddf] transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent';
  return {
    open,
    menu: menu && createPortal(<div ref={menuRef} role="menu" aria-label="提示词编辑菜单"
      className="nodrag nopan nowheel fixed z-[10001] w-40 rounded-xl border border-white/[0.13] bg-[#292929] p-1.5 shadow-[0_16px_42px_rgba(0,0,0,0.52)]"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.preventDefault()}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }} onDoubleClick={(event) => event.stopPropagation()}>
      <button type="button" role="menuitem" disabled={!menu.text} onClick={() => void copy()} className={buttonClass}><Copy className="h-4 w-4" />复制</button>
      <button type="button" role="menuitem" disabled={disabled} onClick={() => void paste()} className={buttonClass}><ClipboardPaste className="h-4 w-4" />粘贴</button>
      <button type="button" role="menuitem" onClick={selectAll} className={buttonClass}><TextSelect className="h-4 w-4" />全选</button>
    </div>, document.body),
  };
}
