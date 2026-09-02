import { Film, Image as ImageIcon, Sparkles } from 'lucide-react';
import { Select, type SelectOption } from '../../../components/ui/Select';

export type CanvasNodeKind = 'text' | 'image' | 'video';
export type CanvasModelId =
  | 'glm-4-flash'
  | 'glm-4-plus'
  | 'glm-4-air'
  | 'cogview-3-flash'
  | 'cogvideox-flash';

const MODEL_OPTIONS: Record<CanvasNodeKind, SelectOption<CanvasModelId>[]> = {
  text: [
    {
      value: 'glm-4-flash',
      label: 'GLM-4-Flash',
      description: '快速生成脚本',
      icon: <Sparkles className="h-4 w-4" />,
    },
    {
      value: 'glm-4-plus',
      label: 'GLM-4-Plus',
      description: '更强理解与创意能力',
      icon: <Sparkles className="h-4 w-4" />,
    },
    {
      value: 'glm-4-air',
      label: 'GLM-4-Air',
      description: '速度与质量均衡',
      icon: <Sparkles className="h-4 w-4" />,
    },
  ],
  image: [
    {
      value: 'cogview-3-flash',
      label: 'CogView-3-Flash',
      description: '智谱图片生成模型',
      icon: <ImageIcon className="h-4 w-4" />,
    },
  ],
  video: [
    {
      value: 'cogvideox-flash',
      label: 'CogVideoX-Flash',
      description: '智谱视频生成模型',
      icon: <Film className="h-4 w-4" />,
    },
  ],
};

export const DEFAULT_CANVAS_MODELS: Record<CanvasNodeKind, CanvasModelId> = {
  text: 'glm-4-flash',
  image: 'cogview-3-flash',
  video: 'cogvideox-flash',
};

export function normalizeCanvasModel(kind: CanvasNodeKind, value?: string): CanvasModelId {
  return MODEL_OPTIONS[kind].some((option) => option.value === value)
    ? (value as CanvasModelId)
    : DEFAULT_CANVAS_MODELS[kind];
}

export function NodeModelSelect({
  kind,
  value,
  onChange,
  disabled = false,
}: {
  kind: CanvasNodeKind;
  value: CanvasModelId;
  onChange: (value: CanvasModelId) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      options={MODEL_OPTIONS[kind]}
      onValueChange={onChange}
      ariaLabel={`选择${kind === 'text' ? '文本' : kind === 'image' ? '图片' : '视频'}生成模型`}
      disabled={disabled}
    />
  );
}
