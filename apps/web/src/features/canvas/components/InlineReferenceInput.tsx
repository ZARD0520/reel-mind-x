import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { AlignLeft, FileText, Film, Image as ImageIcon, Music, X } from 'lucide-react';
import type { CanvasChatReference } from '../chat-types';
import { readableReferences, referenceIds, referenceToken, splitReferences } from '../inline-references';
import { createReferenceIcon } from './reference-icon';
import { useReferenceHoverPreview } from './ReferenceHoverPreview';
import { usePromptEditMenu } from './usePromptEditMenu';

export type InlineReferenceInputHandle = { insert: (reference: CanvasChatReference) => void; focus: () => void };
type Props = {
  value: string;
  candidates: CanvasChatReference[];
  /** 已有引用的展示信息，可包含当前模型不支持的节点。 */
  referenceItems?: CanvasChatReference[];
  onChange: (value: string) => void;
  onReference?: (reference: CanvasChatReference) => boolean;
  onSubmit: () => void;
  placeholder: string;
  label: string;
  disabled?: boolean;
  maxReferences?: number;
  maxLength?: number;
  variant?: 'node' | 'chat';
  /** 覆盖/追加编辑区的样式（如首页输入框的字号与最小高度） */
  editorClassName?: string;
};

/**
 * 清理浏览器删除文本后遗留的占位 <br>（如删除引用前的文字后得到 <br><chip>）：
 * 它会渲染出幻影空行，且导致光标无法再落到引用 chip 之前。换行由文本 \n 承担，根级 <br> 一律是残留物。
 */
function normalizeBreaks(element: HTMLElement) {
  for (const br of Array.from(element.querySelectorAll(':scope > br'))) br.remove();
}

function serialize(node: Node): string {
  if (node instanceof HTMLElement && node.dataset.reference) return node.dataset.reference;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeName === 'BR') return '\n';
  // Browsers leave a placeholder <br> when the last character is deleted.
  const children = Array.from(node.childNodes);
  if (children.filter((child) => child.nodeName === 'BR').length === 1 &&
    children.every((child) => child.nodeName === 'BR' || (child.nodeType === Node.TEXT_NODE && !child.textContent))) return '';
  return Array.from(node.childNodes).map((child, index) =>
    `${index && child.nodeName === 'DIV' ? '\n' : ''}${serialize(child)}`).join('');
}

export const InlineReferenceInput = forwardRef<InlineReferenceInputHandle, Props>(function InlineReferenceInput({ value, candidates, referenceItems = candidates, onChange, onReference, onSubmit, placeholder, label, disabled, maxReferences, maxLength, variant = 'node', editorClassName }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const iconTemplates = useRef<HTMLSpanElement>(null);
  const editMenu = usePromptEditMenu(root, disabled);
  const cursor = useRef(value.length);
  const composing = useRef(false);
  const [mention, setMention] = useState<{ start: number; end: number; query: string } | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const hover = useReferenceHoverPreview(variant);
  const [, refreshInput] = useState(0);
  // Reference chips rebuild the editable DOM, so the browser's native undo stack
  // cannot reliably restore it. Keep serialized text and caret positions instead.
  type EditState = { text: string; cursor: number };
  const edits = useRef({ current: value, past: [] as EditState[], future: [] as EditState[], time: 0, typing: false });
  const beforeCursor = useRef(value.length);
  useLayoutEffect(() => {
    if (edits.current.current === value) return;
    edits.current = { current: value, past: [], future: [], time: 0, typing: false };
  }, [value]);
  function commit(text: string, typing = false) {
    if (maxLength && readableReferences(text).length > maxLength && readableReferences(text).length > readableReferences(value).length) {
      cursor.current = Math.min(cursor.current, value.length);
      refreshInput(revision => revision + 1);
      return;
    }
    const history = edits.current;
    if (text !== history.current) {
      const now = Date.now();
      if (!typing || !history.typing || now - history.time > 600) {
        history.past.push({ text: history.current, cursor: beforeCursor.current });
        if (history.past.length > 100) history.past.shift();
      }
      history.future = [];
      history.current = text;
      history.time = now;
      history.typing = typing;
    }
    onChange(text);
  }

  function restoreEdit(redo: boolean) {
    if (disabled) return;
    const history = edits.current;
    const source = redo ? history.future : history.past;
    const target = redo ? history.past : history.future;
    const state = source.pop();
    if (!state) return;
    target.push({ text: history.current, cursor: selectionOffset() });
    history.current = state.text;
    history.typing = false;
    cursor.current = state.cursor;
    onChange(state.text);
    setMention(null);
    hover.close();
    refreshInput(revision => revision + 1);
  }
  const limited = !!maxReferences && referenceIds(value).length >= maxReferences;
  const matches = mention ? candidates.filter((item) => (!limited || referenceIds(value).includes(item.id)) && `${item.title} ${item.kind === 'text' ? '文本' : item.kind === 'image' ? '图片' : '视频'}`.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 8) : [];

  function selectionOffset() {
    const selection = window.getSelection();
    if (!root.current || !selection?.rangeCount || !root.current.contains(selection.anchorNode)) return cursor.current;
    const range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(root.current);
    range.setEnd(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);
    return serialize(range.cloneContents()).length;
  }

  function placeCursor(offset: number) {
    const element = root.current;
    if (!element) return;
    let remaining = offset;
    const range = document.createRange();
    for (const child of element.childNodes) {
      const length = serialize(child).length;
      if (remaining <= length) {
        if (child.nodeType === Node.TEXT_NODE) range.setStart(child, remaining);
        else if (remaining === 0) range.setStartBefore(child);
        else range.setStartAfter(child);
        range.collapse(true);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
        return;
      }
      remaining -= length;
    }
    range.selectNodeContents(element);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }

  useLayoutEffect(() => {
    const element = root.current;
    if (!element || composing.current) return;
    if (!value) { element.replaceChildren(); return; }
    function decorateChips() {
      for (const chip of element!.querySelectorAll<HTMLElement>('[data-node-id]')) {
        const reference = referenceItems.find((item) => item.id === chip.dataset.nodeId);
        const inactive = variant === 'node' && !candidates.some(item => item.id === chip.dataset.nodeId);
        const part = splitReferences(chip.dataset.reference ?? '')[0];
        const title = reference?.title ?? part?.title ?? '';
        const appearance = JSON.stringify(['lucide', title, reference?.kind, variant, disabled, inactive]);
        if (chip.dataset.appearance === appearance) continue;
        chip.dataset.appearance = appearance;
        chip.className = variant === 'node'
          ? 'mx-0.5 inline-flex h-7 max-w-36 cursor-pointer items-center gap-1.5 rounded-lg border border-white/[0.09] bg-white/[0.1] px-2 align-middle text-xs leading-4 text-[#e0e0e2]'
          : 'mx-0.5 inline-flex h-6 max-w-full cursor-pointer items-center gap-1 rounded-md bg-white/[0.12] px-2 align-middle text-xs leading-4 text-[#dededb] transition-colors hover:bg-white/[0.20]';
        const label = document.createElement('span');
        label.className = variant === 'node' ? 'min-w-0 max-w-36 truncate' : 'min-w-0 max-w-44 truncate';
        label.textContent = title;
        if (inactive) {
          chip.className += ' opacity-40';
          label.className += ' line-through';
          chip.title = '当前模型不支持此引用或节点已断开，此引用不会参与生成';
          chip.dataset.inactiveReference = 'true';
        } else {
          chip.removeAttribute('title');
          delete chip.dataset.inactiveReference;
        }
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.tabIndex = -1;
        remove.disabled = !!disabled;
        remove.dataset.removeReference = 'true';
        remove.setAttribute('aria-label', variant === 'node' ? `移除提示词引用 ${title}` : `移除引用${title}`);
        remove.className = '-mr-1 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-[#929297] hover:bg-white/[0.08] hover:text-white disabled:cursor-default';
        remove.append(createReferenceIcon('remove', iconTemplates.current!, variant));
        chip.replaceChildren(createReferenceIcon(reference?.kind ?? 'text', iconTemplates.current!, variant), label, remove);
      }
    }
    if (serialize(element) === value) { decorateChips(); return; }
    const focused = document.activeElement === element;
    element.replaceChildren(...splitReferences(value).map((part) => {
      if (!part.id) return document.createTextNode(part.text);
      const chip = document.createElement('span');
      chip.contentEditable = 'false';
      chip.dataset.reference = part.text;
      chip.dataset.nodeId = part.id;
      return chip;
    }), document.createTextNode(''));
    decorateChips();
    if (focused) placeCursor(cursor.current);
  });

  function updateMention(text = value) {
    cursor.current = selectionOffset();
    const found = /@([^@\s\[\]]*)$/.exec(text.slice(0, cursor.current));
    setMention(found ? { start: cursor.current - found[0].length, end: cursor.current, query: found[1] ?? '' } : null);
    setHighlighted(0);
  }

  function insert(reference: CanvasChatReference) {
    if (variant === 'node' && !candidates.some(item => item.id === reference.id)) return;
    if (disabled || (limited && !referenceIds(value).includes(reference.id)) || onReference?.(reference) === false) return;
    // 聚焦时插入到实时光标位置；未聚焦时插入到内容最末尾
    const focused = document.activeElement === root.current;
    const offset = focused ? selectionOffset() : value.length;
    const start = focused ? (mention?.start ?? offset) : value.length;
    const end = focused ? (mention?.end ?? offset) : value.length;
    beforeCursor.current = offset;
    const token = referenceToken(reference);
    cursor.current = start + token.length + 1;
    commit(value.slice(0, start) + token + ' ' + value.slice(end));
    setMention(null);
    root.current?.focus();
  }
  useImperativeHandle(ref, () => ({ insert, focus: () => root.current?.focus() }));

  function hoveredChip(target: EventTarget | null) {
    return target instanceof Element ? target.closest<HTMLElement>('[data-node-id]') : null;
  }

  return <div className="relative min-w-0 flex-1">
    <span ref={iconTemplates} className="hidden" aria-hidden="true">
      <AlignLeft data-reference-kind="node-text" className="h-3.5 w-3.5 shrink-0" />
      <FileText data-reference-kind="text" className="h-3.5 w-3.5 shrink-0" />
      <ImageIcon data-reference-kind="image" className="h-3.5 w-3.5 shrink-0" />
      <Film data-reference-kind="video" className="h-3.5 w-3.5 shrink-0" />
      <Music data-reference-kind="audio" className="h-3.5 w-3.5 shrink-0" />
      <X data-reference-kind="remove" className="h-3 w-3" />
    </span>
    {mention && !disabled && <div role="listbox" aria-label="引用画布节点" className="reel-scroll nowheel absolute bottom-full left-0 z-50 mb-2 max-h-60 w-full min-w-56 overflow-y-auto rounded-xl border border-white/15 bg-[#282828] p-1.5 shadow-2xl">
      {matches.length ? matches.map((item, index) => <button type="button" role="option" aria-selected={index === highlighted} key={item.id} onMouseEnter={() => setHighlighted(index)} onMouseMove={() => setHighlighted(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => insert(item)} className={`block w-full cursor-pointer truncate rounded-lg px-3 py-2 text-left text-sm text-[#dededb] transition-colors hover:bg-white/10 ${index === highlighted ? 'bg-white/10' : ''}`}>{item.title}<span className="ml-2 text-xs text-[#929296]">{item.kind === 'text' ? '文本' : item.kind === 'image' ? '图片' : '视频'}</span></button>) : <p className="px-3 py-2 text-xs text-[#929296]">{limited ? `最多引用 ${maxReferences} 个节点` : '没有匹配的节点'}</p>}
    </div>}
    <div ref={root} contentEditable={!disabled} suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={label} aria-disabled={disabled} data-placeholder={placeholder}
      data-node-prompt-input={variant === 'node' ? '' : undefined}
      onContextMenu={(event) => { event.stopPropagation(); if (variant === 'node') { event.preventDefault(); hover.close(); setMention(null); editMenu.open(event); } }}
      onDoubleClick={(event) => event.stopPropagation()}
      onMouseOver={(event) => {
        const chip = hoveredChip(event.target);
        if (!chip || chip.contains(event.relatedTarget as Node | null)) return;
        const reference = referenceItems.find((item) => item.id === chip.dataset.nodeId);
        const part = splitReferences(chip.dataset.reference ?? '')[0];
        hover.show(reference ?? { id: chip.dataset.nodeId!, title: part?.title ?? '', kind: 'text' }, chip, !!reference);
      }}
      onMouseOut={(event) => { const chip = hoveredChip(event.target); if (chip && !chip.contains(event.relatedTarget as Node | null)) hover.hide(); }}
      className={`reel-scroll min-h-[56px] max-h-60 w-full overflow-y-auto overscroll-contain whitespace-pre-wrap break-words bg-transparent px-1 py-1 text-sm leading-7 text-[#f3f3f0] outline-none empty:before:pointer-events-none empty:before:text-[#68686d] empty:before:content-[attr(data-placeholder)] ${editorClassName ?? ''}`}
      onCompositionStart={() => { beforeCursor.current = selectionOffset(); composing.current = true; }} onCompositionEnd={() => { composing.current = false; const text = serialize(root.current!); commit(text); updateMention(text); }}
      onBeforeInput={() => { if (!composing.current) beforeCursor.current = selectionOffset(); }}
      onInput={(event) => { normalizeBreaks(root.current!); const text = serialize(root.current!); cursor.current = selectionOffset(); if (!composing.current) commit(text, (event.nativeEvent as InputEvent).inputType === 'insertText'); if (!composing.current) updateMention(text); }}
      onMouseDown={(event) => { edits.current.typing = false; if (event.target instanceof Element && event.target.closest('[data-remove-reference]')) event.preventDefault(); }}
      onClick={(event) => {
        const remove = event.target instanceof Element && event.target.closest('[data-remove-reference]');
        const chip = remove && hoveredChip(event.target);
        if (chip && !disabled) {
          let offset = 0;
          for (const child of root.current!.childNodes) { if (child === chip) break; offset += serialize(child).length; }
          cursor.current = offset;
          beforeCursor.current = selectionOffset();
          commit(value.slice(0, offset) + value.slice(offset + (chip.dataset.reference?.length ?? 0)));
          hover.close();
          setMention(null);
        } else updateMention();
      }} onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { edits.current.typing = false; updateMention(); } }}
      onBlur={() => { cursor.current = selectionOffset(); setMention(null); }}
      onPaste={(event) => { event.preventDefault(); edits.current.typing = false; document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); edits.current.typing = false; }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || composing.current || event.nativeEvent.keyCode === 229) return;
        const key = event.key.toLowerCase();
        if ((event.metaKey || event.ctrlKey) && !event.altKey && (key === 'z' || key === 'y')) {
          event.preventDefault();
          restoreEdit(key === 'y' || event.shiftKey);
          return;
        }
        if (mention && matches.length && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
          event.preventDefault();
          if (event.key === 'Enter') insert(matches[Math.min(highlighted, matches.length - 1)]!);
          else setHighlighted((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
        } else if (event.key === 'Escape' && mention) { event.preventDefault(); setMention(null); }
        else if (event.key === 'Enter') { event.preventDefault(); if (event.shiftKey) document.execCommand('insertText', false, '\n'); else onSubmit(); }
      }} />
    {hover.preview}
    {editMenu.menu}
  </div>;
});
