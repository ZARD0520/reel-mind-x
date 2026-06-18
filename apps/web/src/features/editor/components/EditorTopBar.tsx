import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, Loader2, Pencil, Redo2, Undo2, Upload } from 'lucide-react';

interface EditorTopBarProps {
  projectId: string;
  projectName?: string;
  isSaving?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onRename?: (name: string) => void;
}

export function EditorTopBar({
  projectId,
  projectName,
  isSaving,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onRename,
}: EditorTopBarProps) {
  const navigate = useNavigate();
  const shortId = projectId.slice(0, 8);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startEdit = () => {
    setDraft(projectName ?? '');
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const name = draft.trim();
    if (name && name !== projectName) onRename?.(name);
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-border-subtle bg-surface px-4">
      <div className="flex items-center gap-3.5">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-elevated text-fg-secondary hover:text-fg"
        >
          <ChevronLeft className="h-[18px] w-[18px]" />
        </button>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            maxLength={80}
            className="w-56 rounded-md border border-border-subtle bg-input px-2 py-1 text-sm font-medium text-fg outline-none focus:border-accent"
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            title="点击重命名"
            className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-elevated"
          >
            <span className="text-sm font-medium">{projectName ?? '未命名项目'}</span>
            <Pencil className="h-[13px] w-[13px] text-fg-tertiary group-hover:text-fg-secondary" />
          </button>
        )}
        <span className="text-xs text-fg-tertiary">ID: {shortId}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          title="撤销 (Ctrl+Z)"
          disabled={!canUndo}
          onClick={onUndo}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-secondary hover:bg-elevated disabled:opacity-40"
        >
          <Undo2 className="h-[17px] w-[17px]" />
        </button>
        <button
          title="重做 (Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={onRedo}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-secondary hover:bg-elevated disabled:opacity-40"
        >
          <Redo2 className="h-[17px] w-[17px]" />
        </button>
      </div>

      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5 rounded-lg bg-elevated px-3.5 py-2 text-fg-secondary">
          {isSaving ? (
            <>
              <Loader2 className="h-[15px] w-[15px] animate-spin" />
              <span className="text-[13px] font-medium">保存中…</span>
            </>
          ) : (
            <>
              <Check className="h-[15px] w-[15px]" />
              <span className="text-[13px] font-medium">已保存</span>
            </>
          )}
        </div>
        <button className="flex items-center gap-1.5 rounded-lg bg-accent px-[18px] py-2 text-fg hover:bg-accent-hover">
          <Upload className="h-[15px] w-[15px]" />
          <span className="text-[13px] font-semibold">导出</span>
        </button>
      </div>
    </header>
  );
}
