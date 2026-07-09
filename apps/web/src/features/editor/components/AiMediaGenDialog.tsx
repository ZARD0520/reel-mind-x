import { useState } from 'react';
import { Film, Image, Loader2, Sparkles, X } from 'lucide-react';
import { useGenerateMedia } from '../hooks';
import { RATIO_OPTIONS, IMAGE_SIZE_BY_RATIO, VIDEO_SIZE_BY_RATIO, type AspectRatioKey } from '../constants';

interface AiMediaGenDialogProps {
  open: boolean;
  projectId: string;
  type: 'image' | 'video';
  onClose: () => void;
}

export function AiMediaGenDialog({ open, projectId, type, onClose }: AiMediaGenDialogProps) {
  const [prompt, setPrompt] = useState('');
  const [ratio, setRatio] = useState<AspectRatioKey>('16:9');
  const { image, video } = useGenerateMedia(projectId);
  const mutation = type === 'image' ? image : video;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || mutation.isPending) return;
    const sizeMap = type === 'image' ? IMAGE_SIZE_BY_RATIO : VIDEO_SIZE_BY_RATIO;
    const size = sizeMap[ratio];
    mutation.mutate({ prompt: text, size });
  };

  const handleClose = () => {
    setPrompt('');
    mutation.reset();
    onClose();
  };

  if (!open) return null;

  const Icon = type === 'image' ? Image : Film;
  const title = type === 'image' ? 'AI 生成图片' : 'AI 生成视频';
  const placeholder =
    type === 'image'
      ? '描述想要的图片，如：一只猫坐在窗边看星空，赛博朋克风格'
      : '描述想要的视频，如：海浪拍打沙滩，夕阳西下';
  const estimatedTime = type === 'image' ? '约 5-10 秒' : '约 1-3 分钟';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4">
      <div className="flex w-[520px] max-w-full flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-2xl">
        {/* 头部 */}
        <div className="flex h-13 items-center justify-between border-b border-border-subtle px-4">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-accent" />
            <span className="text-sm font-semibold">{title}</span>
          </div>
          <button type="button" onClick={handleClose} className="text-fg-tertiary hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 内容 */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
          {/* 提示词输入 */}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={placeholder}
            rows={4}
            disabled={mutation.isPending}
            className="resize-none rounded-lg border border-border-subtle bg-input px-3 py-2 text-[13px] text-fg outline-none placeholder:text-fg-tertiary focus:border-accent disabled:opacity-50"
          />

          {/* 尺寸比例选择器 */}
          <div className="flex flex-col gap-2">
            <span className="text-xs text-fg-tertiary">生成比例</span>
            <div className="flex gap-2">
              {RATIO_OPTIONS.map((opt) => {
                const isActive = ratio === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setRatio(opt.key)}
                    disabled={mutation.isPending}
                    className={`flex-1 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors ${
                      isActive
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border-subtle bg-input text-fg-secondary hover:border-accent/50'
                    } disabled:opacity-50`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {mutation.isSuccess && (
            <p className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-[12px] text-green-300">
              ✓ 生成任务已提交，素材列表中查看进度（{estimatedTime}）
            </p>
          )}
          {mutation.isError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
              {mutation.error instanceof Error ? mutation.error.message : '生成失败'}
            </p>
          )}
          <button
            type="submit"
            disabled={!prompt.trim() || mutation.isPending}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {mutation.isPending ? '提交中' : '生成'}
          </button>
        </form>
      </div>
    </div>
  );
}
