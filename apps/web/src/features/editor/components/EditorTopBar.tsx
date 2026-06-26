import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  ChevronLeft,
  Download,
  Loader2,
  Pencil,
  Redo2,
  Sparkles,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { useExport } from '../hooks';
import type { RenderJob } from '@reel/contracts';

interface EditorTopBarProps {
  projectId: string;
  projectName?: string;
  isSaving?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onRename?: (name: string) => void;
  onOpenAiMix?: () => void;
  /** 导出前刷新保存最新 timeline（返回 Promise，待保存完成再入队渲染） */
  onBeforeExport?: () => Promise<void>;
  /** 项目时长（秒），用于估算文件大小 */
  durationSec: number;
  /** 项目分辨率，用于估算文件大小 */
  width: number;
  height: number;
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
  onOpenAiMix,
  onBeforeExport,
  durationSec,
  width,
  height,
}: EditorTopBarProps) {
  const navigate = useNavigate();
  const shortId = projectId.slice(0, 8);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportName, setExportName] = useState('');
  const [exportQuality, setExportQuality] = useState<'high' | 'medium' | 'low'>('high');
  const [confirmed, setConfirmed] = useState(false);
  const { start, starting, job, reset } = useExport(projectId);

  const exporting = starting || job?.status === 'queued' || job?.status === 'rendering';
  // 弹窗两阶段：未确认 → 显示设置（名称/质量）；确认后 → 显示进度/结果。
  const showSettings = exportOpen && !confirmed;

  const openExport = () => {
    setExportName(projectName ?? '未命名项目');
    setExportQuality('high');
    setConfirmed(false);
    setExportOpen(true);
  };
  const confirmExport = () => {
    setConfirmed(true);
    void (async () => {
      await onBeforeExport?.(); // 先落库最新 timeline
      start({ fileName: exportName.trim() || undefined, quality: exportQuality });
    })();
  };
  const closeExport = () => {
    setExportOpen(false);
    setConfirmed(false);
    if (job?.status === 'completed' || job?.status === 'failed') reset();
  };

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
        <button
          type="button"
          onClick={onOpenAiMix}
          className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-elevated px-3.5 py-2 text-fg-secondary hover:text-fg"
        >
          <Sparkles className="h-[15px] w-[15px] text-accent" />
          <span className="text-[13px] font-semibold">AI 混编</span>
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={openExport}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-[18px] py-2 text-fg hover:bg-accent-hover disabled:opacity-70"
          >
            {exporting ? (
              <Loader2 className="h-[15px] w-[15px] animate-spin" />
            ) : (
              <Upload className="h-[15px] w-[15px]" />
            )}
            <span className="text-[13px] font-semibold">{exporting ? '导出中…' : '导出'}</span>
          </button>

          {exportOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[320px] rounded-xl border border-border-subtle bg-surface p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold">导出视频</span>
                <button
                  type="button"
                  onClick={closeExport}
                  className="text-fg-tertiary hover:text-fg"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {showSettings ? (
                <ExportSettings
                  name={exportName}
                  quality={exportQuality}
                  onName={setExportName}
                  onQuality={setExportQuality}
                  onConfirm={confirmExport}
                  durationSec={durationSec}
                  width={width}
                  height={height}
                />
              ) : (
                <ExportBody
                  job={job}
                  starting={starting}
                  onRetry={() =>
                    start({ fileName: exportName.trim() || undefined, quality: exportQuality })
                  }
                />
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function ExportSettings({
  name,
  quality,
  onName,
  onQuality,
  onConfirm,
  durationSec,
  width,
  height,
}: {
  name: string;
  quality: 'high' | 'medium' | 'low';
  onName: (v: string) => void;
  onQuality: (v: 'high' | 'medium' | 'low') => void;
  onConfirm: () => void;
  durationSec: number;
  width: number;
  height: number;
}) {
  // 粗略估算文件大小（MB）：基于分辨率、时长、质量档的典型码率。
  const estimateSize = (q: 'high' | 'medium' | 'low'): number => {
    const pixels = width * height;
    const scale = q === 'low' ? 0.5 : 1;
    const scaledPixels = pixels * scale * scale;
    // 典型码率（Mbps）：1080p@high≈10, @medium≈5, @low≈1.5; 按像素数线性缩放。
    const base1080p = { high: 10, medium: 5, low: 1.5 }[q];
    const mbps = base1080p * (scaledPixels / (1920 * 1080));
    // 音频码率（Mbps）
    const audioMbps = { high: 0.192, medium: 0.128, low: 0.096 }[q];
    return ((mbps + audioMbps) * durationSec) / 8; // bit -> byte -> MB
  };

  const QUALITIES: { key: 'high' | 'medium' | 'low'; label: string; desc: string }[] = [
    { key: 'high', label: '高清', desc: `原分辨率 · 高码率 · ~${Math.round(estimateSize('high'))} MB` },
    { key: 'medium', label: '标准', desc: `原分辨率 · 中码率 · ~${Math.round(estimateSize('medium'))} MB` },
    { key: 'low', label: '流畅', desc: `半分辨率 · 低码率 · ~${Math.round(estimateSize('low'))} MB` },
  ];
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <label className="text-[12px] text-fg-secondary">文件名</label>
        <div className="flex items-center gap-1">
          <input
            value={name}
            onChange={(e) => onName(e.target.value)}
            maxLength={100}
            className="min-w-0 flex-1 rounded-md border border-border-subtle bg-input px-2 py-1.5 text-[13px] text-fg outline-none focus:border-accent"
          />
          <span className="text-[12px] text-fg-tertiary">.mp4</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-[12px] text-fg-secondary">质量</label>
        <div className="flex flex-col gap-1.5">
          {QUALITIES.map((q) => (
            <button
              key={q.key}
              type="button"
              onClick={() => onQuality(q.key)}
              className={`flex items-center justify-between rounded-md border px-2.5 py-2 text-left transition-colors ${
                quality === q.key
                  ? 'border-accent bg-accent-soft'
                  : 'border-border-subtle hover:bg-elevated'
              }`}
            >
              <span className="text-[13px] font-medium text-fg">{q.label}</span>
              <span className="text-[11px] text-fg-tertiary">{q.desc}</span>
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={onConfirm}
        className="mt-1 rounded-lg bg-accent py-2 text-[13px] font-semibold text-fg hover:bg-accent-hover"
      >
        开始导出
      </button>
    </div>
  );
}

function ExportBody({
  job,
  starting,
  onRetry,
}: {
  job: RenderJob | null;
  starting: boolean;
  onRetry: () => void;
}) {
  if (starting || !job || job.status === 'queued') {
    return <ProgressView label="排队中…" percent={0} />;
  }
  if (job.status === 'rendering') {
    return <ProgressView label="合成中…" percent={job.progress} />;
  }
  if (job.status === 'failed') {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-red-400">导出失败</p>
        <p className="max-h-24 overflow-y-auto break-words text-[11px] text-fg-tertiary">
          {job.error ?? '未知错误'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="self-start rounded-lg bg-elevated px-3 py-1.5 text-[13px] text-fg-secondary hover:text-fg"
        >
          重试
        </button>
      </div>
    );
  }
  // completed
  return (
    <div className="flex flex-col gap-3">
      <ProgressView label="完成" percent={100} />
      <a
        href={job.outputUrl ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-fg hover:bg-accent-hover"
      >
        <Download className="h-4 w-4" />
        预览视频
      </a>
      <a
        href={job.outputUrl ?? '#'}
        download={job.fileName ?? '导出视频.mp4'}
        className="text-center text-[12px] text-accent hover:underline"
      >
        或点此下载
      </a>
    </div>
  );
}

function ProgressView({ label, percent }: { label: string; percent: number }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-fg-secondary">{label}</span>
        <span className="tabular-nums text-fg-tertiary">{Math.round(percent)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-timeline-track">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      </div>
    </div>
  );
}
