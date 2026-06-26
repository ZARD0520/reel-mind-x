import { useEffect, useMemo, useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import type { AiMixStyle, Asset, Timeline } from '@reel/contracts';
import { useAiMix } from '../hooks';

interface AiMixDialogProps {
  open: boolean;
  projectId: string;
  assets: Asset[];
  onClose: () => void;
  onApply: (timeline: Timeline) => void;
}

const DURATIONS = [15, 30, 45] as const;
const STYLES: { key: AiMixStyle; label: string }[] = [
  { key: 'fast', label: '快节奏' },
  { key: 'hook', label: '强钩子' },
  { key: 'steady', label: '稳重讲解' },
];

function formatDuration(frames: number | null): string {
  if (!frames) return '';
  const sec = Math.round(frames / 30);
  return `${sec}s`;
}

export function AiMixDialog({ open, projectId, assets, onClose, onApply }: AiMixDialogProps) {
  const usableAssets = useMemo(
    () => assets.filter((asset) => asset.status === 'ready' && (asset.kind === 'video' || asset.kind === 'image' || asset.kind === 'audio')),
    [assets],
  );
  const defaultAssetIds = useMemo(
    () => usableAssets.filter((asset) => asset.kind !== 'audio').map((asset) => asset.id),
    [usableAssets],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(defaultAssetIds);
  const [durationSec, setDurationSec] = useState<(typeof DURATIONS)[number]>(30);
  const [style, setStyle] = useState<AiMixStyle>('fast');
  const [sellingPoints, setSellingPoints] = useState('提升转化效率\n降低获客成本\n快速产出广告素材');
  const [cta, setCta] = useState('立即咨询');
  const { start, starting, job, error, reset } = useAiMix(projectId);

  useEffect(() => {
    if (open) {
      setSelectedIds(defaultAssetIds);
      reset();
    }
  }, [defaultAssetIds, open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const selectedCount = selectedIds.length;
  const running = starting || job?.status === 'queued' || job?.status === 'running';
  const draftTimeline = job?.status === 'completed' ? job.draftTimeline : null;

  const toggleAsset = (id: string) => {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
  };
  const submit = () => {
    const points = sellingPoints
      .split(/\n|,|，/)
      .map((item) => item.trim())
      .filter(Boolean);
    start({ assetIds: selectedIds, durationSec, style, sellingPoints: points, cta: cta.trim() || '立即咨询' });
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4">
      <div className="flex max-h-[86vh] w-[760px] max-w-full flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-2xl">
        <div className="flex h-13 items-center justify-between border-b border-border-subtle px-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold">AI 广告混编</span>
          </div>
          <button type="button" onClick={onClose} className="text-fg-tertiary hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[1.1fr_0.9fr] gap-0 overflow-hidden">
          <div className="min-h-0 overflow-y-auto border-r border-border-subtle p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[13px] font-medium text-fg-secondary">素材</span>
              <span className="text-[12px] text-fg-tertiary">已选 {selectedCount}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {usableAssets.map((asset) => {
                const active = selectedIds.includes(asset.id);
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => toggleAsset(asset.id)}
                    className={`min-h-[66px] rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      active ? 'border-accent bg-accent-soft' : 'border-border-subtle bg-elevated/40 hover:bg-elevated'
                    }`}
                  >
                    <span className="block truncate text-[13px] font-medium text-fg">{asset.name}</span>
                    <span className="mt-1 block text-[11px] text-fg-tertiary">
                      {asset.kind} {formatDuration(asset.durationInFrames)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto p-4">
            <div className="flex flex-col gap-4">
              <div>
                <div className="mb-2 text-[13px] font-medium text-fg-secondary">成片时长</div>
                <div className="grid grid-cols-3 gap-2">
                  {DURATIONS.map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => setDurationSec(sec)}
                      className={`rounded-lg border py-2 text-[13px] ${
                        durationSec === sec ? 'border-accent bg-accent-soft text-fg' : 'border-border-subtle text-fg-secondary hover:bg-elevated'
                      }`}
                    >
                      {sec}s
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 text-[13px] font-medium text-fg-secondary">风格</div>
                <div className="grid grid-cols-3 gap-2">
                  {STYLES.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setStyle(item.key)}
                      className={`rounded-lg border py-2 text-[13px] ${
                        style === item.key ? 'border-accent bg-accent-soft text-fg' : 'border-border-subtle text-fg-secondary hover:bg-elevated'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex flex-col gap-2">
                <span className="text-[13px] font-medium text-fg-secondary">卖点</span>
                <textarea
                  value={sellingPoints}
                  onChange={(e) => setSellingPoints(e.target.value)}
                  rows={4}
                  className="resize-none rounded-lg border border-border-subtle bg-input px-3 py-2 text-[13px] text-fg outline-none focus:border-accent"
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-[13px] font-medium text-fg-secondary">CTA</span>
                <input
                  value={cta}
                  onChange={(e) => setCta(e.target.value)}
                  className="rounded-lg border border-border-subtle bg-input px-3 py-2 text-[13px] text-fg outline-none focus:border-accent"
                />
              </label>

              {job?.status === 'failed' || error ? (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
                  {job?.error ?? (error instanceof Error ? error.message : '生成失败')}
                </p>
              ) : null}

              <button
                type="button"
                disabled={running || selectedCount === 0}
                onClick={submit}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-fg hover:bg-accent-hover disabled:opacity-50"
              >
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {running ? '生成中' : draftTimeline ? '重新生成' : '生成方案'}
              </button>

              {draftTimeline && (
                <button
                  type="button"
                  onClick={() => onApply(draftTimeline)}
                  className="rounded-lg border border-border-subtle bg-elevated px-3 py-2 text-[13px] font-semibold text-fg-secondary hover:text-fg"
                >
                  应用到当前项目
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
