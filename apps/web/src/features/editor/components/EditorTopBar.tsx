import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Download,
  Loader2,
  Pencil,
  Redo2,
  RotateCcw,
  Sparkles,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { useExport } from '../hooks';
import type { RenderFailureCategory, RenderJob, RenderStage } from '@reel/contracts';

interface EditorTopBarProps {
  projectId: string;
  projectName?: string;
  isSaving?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onRename?: (name: string) => void;
  onBack?: () => void | Promise<void>;
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
  onBack,
  onOpenAiMix,
  onBeforeExport,
  durationSec,
  width,
  height,
}: EditorTopBarProps) {
  const shortId = projectId.slice(0, 8);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportName, setExportName] = useState('');
  const [exportQuality, setExportQuality] = useState<'high' | 'medium' | 'low'>('high');
  const [confirmed, setConfirmed] = useState(false);
  const { start, starting, recovering, startError, job, reset, cancel, cancelling, cancelError } =
    useExport(projectId);

  const exporting =
    starting ||
    job?.status === 'queued' ||
    job?.status === 'rendering' ||
    job?.status === 'retrying' ||
    job?.status === 'cancelling';
  // 弹窗两阶段：未确认 → 显示设置（名称/质量）；确认后 → 显示进度/结果。
  const showSettings = exportOpen && !confirmed;

  const openExport = () => {
    setExportName(job?.fileName?.replace(/\.mp4$/i, '') || projectName || '未命名项目');
    setExportQuality(job?.quality ?? 'high');
    setConfirmed(!!job);
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
  };

  const retryExport = () => {
    void (async () => {
      await onBeforeExport?.();
      start({ fileName: exportName.trim() || undefined, quality: exportQuality });
    })();
  };

  const createAnotherExport = () => {
    reset();
    setConfirmed(false);
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
          onClick={() => void onBack?.()}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-elevated text-fg-secondary hover:text-fg"
          aria-label="返回"
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
            disabled={starting || recovering}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-[18px] py-2 text-fg hover:bg-accent-hover disabled:opacity-70"
          >
            {exporting || recovering ? (
              <Loader2 className="h-[15px] w-[15px] animate-spin" />
            ) : (
              <Upload className="h-[15px] w-[15px]" />
            )}
            <span className="text-[13px] font-semibold">
              {recovering ? '恢复中…' : exporting ? '查看导出' : '导出'}
            </span>
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
                  startError={startError}
                  cancelling={cancelling}
                  cancelError={cancelError}
                  onCancel={cancel}
                  onRetry={retryExport}
                  onNewExport={createAnotherExport}
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
    {
      key: 'high',
      label: '高清',
      desc: `原分辨率 · 高码率 · ~${Math.round(estimateSize('high'))} MB`,
    },
    {
      key: 'medium',
      label: '标准',
      desc: `原分辨率 · 中码率 · ~${Math.round(estimateSize('medium'))} MB`,
    },
    {
      key: 'low',
      label: '流畅',
      desc: `半分辨率 · 低码率 · ~${Math.round(estimateSize('low'))} MB`,
    },
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
  startError,
  cancelling,
  cancelError,
  onCancel,
  onRetry,
  onNewExport,
}: {
  job: RenderJob | null;
  starting: boolean;
  startError: Error | null;
  cancelling: boolean;
  cancelError: Error | null;
  onCancel: () => void;
  onRetry: () => void;
  onNewExport: () => void;
}) {
  if (starting) {
    return <ProgressView label="正在提交导出任务…" percent={0} />;
  }
  if (!job) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[13px] text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          导出任务提交失败
        </div>
        <p className="break-words text-[11px] text-fg-tertiary">
          {startError?.message ?? '未获取到导出任务，请检查网络后重试'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="self-start rounded-lg bg-elevated px-3 py-1.5 text-[13px] text-fg-secondary hover:text-fg"
        >
          重新提交
        </button>
      </div>
    );
  }
  if (job.status === 'queued') {
    return (
      <ActiveExport
        job={job}
        label="排队中…"
        cancelling={cancelling}
        cancelError={cancelError}
        onCancel={onCancel}
      />
    );
  }
  if (job.status === 'rendering') {
    return (
      <ActiveExport
        job={job}
        label={`${RENDER_STAGE_LABELS[job.stage]} · 第 ${job.attemptCount}/${job.maxAttempts} 次`}
        cancelling={cancelling}
        cancelError={cancelError}
        onCancel={onCancel}
      />
    );
  }
  if (job.status === 'retrying') {
    return (
      <div className="flex flex-col gap-3">
        <ProgressView
          label={`自动重试等待中 · 已尝试 ${job.attemptCount}/${job.maxAttempts} 次`}
          percent={job.progress}
        />
        {job.failure && (
          <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200">
            上次失败于{RENDER_STAGE_LABELS[job.failure.stage]}：{job.failure.message}
          </div>
        )}
        <CancelExportButton disabled={cancelling} onCancel={onCancel} />
        {cancelError && <p className="text-[11px] text-red-400">取消失败，请稍后重试</p>}
      </div>
    );
  }
  if (job.status === 'cancelling') {
    return <ProgressView label="正在停止 FFmpeg 并清理临时文件…" percent={job.progress} />;
  }
  if (job.status === 'cancelled') {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-fg-secondary">导出已取消</p>
        <p className="text-[11px] text-fg-tertiary">
          停止位置：{RENDER_STAGE_LABELS[job.failure?.stage ?? job.stage]}，临时文件已清理。
        </p>
        <button
          type="button"
          onClick={onNewExport}
          className="self-start rounded-lg bg-elevated px-3 py-1.5 text-[13px] text-fg-secondary hover:text-fg"
        >
          新建导出
        </button>
      </div>
    );
  }
  if (job.status === 'failed') {
    const failure = job.failure;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[13px] text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          导出失败
        </div>
        <div className="space-y-1 rounded-lg border border-red-400/15 bg-red-400/5 px-3 py-2 text-[11px]">
          <p className="text-fg-secondary">
            失败位置：{RENDER_STAGE_LABELS[failure?.stage ?? job.stage]}
          </p>
          <p className="text-fg-secondary">
            错误分类：{RENDER_CATEGORY_LABELS[failure?.category ?? 'system']}
          </p>
          <p className="text-fg-secondary">
            重试结果：
            {failure?.level === 'exhausted'
              ? `自动重试 ${job.attemptCount} 次后仍然失败`
              : '该错误无法通过自动重试恢复'}
          </p>
          <p className="pt-1 leading-5 text-red-300">
            {failure?.message ?? job.error ?? '未知错误'}
          </p>
          {failure?.code && <p className="font-mono text-fg-tertiary">错误码：{failure.code}</p>}
        </div>
        {failure?.detail && (
          <details className="text-[11px] text-fg-tertiary">
            <summary className="cursor-pointer hover:text-fg-secondary">查看技术详情</summary>
            <pre className="reel-scroll mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-base p-2 font-mono text-[10px]">
              {failure.detail}
            </pre>
          </details>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1.5 self-start rounded-lg bg-elevated px-3 py-1.5 text-[13px] text-fg-secondary hover:text-fg"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          重新导出
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
      <button
        type="button"
        onClick={onNewExport}
        className="text-center text-[12px] text-fg-tertiary hover:text-fg-secondary"
      >
        新建导出
      </button>
    </div>
  );
}

const RENDER_STAGE_LABELS: Record<RenderStage, string> = {
  queued: '任务队列',
  validating: '项目与时间轴校验',
  preparing: '素材读取与媒体探测',
  rendering: 'FFmpeg 视频合成',
  finalizing: '成品文件整理',
  completed: '导出完成',
};

const RENDER_CATEGORY_LABELS: Record<RenderFailureCategory, string> = {
  project: '项目错误',
  timeline: '时间轴错误',
  asset: '素材错误',
  media: '媒体解码或输出错误',
  ffmpeg: 'FFmpeg 渲染错误',
  storage: '文件存储错误',
  queue: '任务队列错误',
  system: '系统内部错误',
  cancelled: '用户取消',
};

function ActiveExport({
  job,
  label,
  cancelling,
  cancelError,
  onCancel,
}: {
  job: RenderJob;
  label: string;
  cancelling: boolean;
  cancelError: Error | null;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <ProgressView label={label} percent={job.progress} />
      <p className="text-[11px] text-fg-tertiary">
        已保存恢复点：
        {job.checkpoint === 'rendered'
          ? '视频已渲染'
          : job.checkpoint === 'prepared'
            ? '素材已准备'
            : job.checkpoint === 'validated'
              ? '时间轴已校验'
              : '等待开始'}
      </p>
      <CancelExportButton disabled={cancelling} onCancel={onCancel} />
      {cancelError && <p className="text-[11px] text-red-400">取消失败，请稍后重试</p>}
    </div>
  );
}

function CancelExportButton({ disabled, onCancel }: { disabled: boolean; onCancel: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onCancel}
      className="self-start rounded-lg border border-red-400/20 px-3 py-1.5 text-[12px] text-red-300 hover:bg-red-400/10 disabled:opacity-50"
    >
      {disabled ? '正在取消…' : '取消导出'}
    </button>
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
