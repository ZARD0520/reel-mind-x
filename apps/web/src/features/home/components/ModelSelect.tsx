import { Sparkles } from 'lucide-react';
import { Select, type SelectOption } from '../../../components/ui/Select';

export type ModelId = 'glm-4-flash' | 'glm-4-plus' | 'glm-4-air';

const modelIcon = <Sparkles className="h-4 w-4" />;

const MODEL_OPTIONS: SelectOption<ModelId>[] = [
  {
    value: 'glm-4-flash',
    label: 'GLM-4-Flash',
    description: '快速生成，适合日常创作',
    icon: modelIcon,
  },
  {
    value: 'glm-4-plus',
    label: 'GLM-4-Plus',
    description: '更强理解与创意能力',
    icon: modelIcon,
  },
  {
    value: 'glm-4-air',
    label: 'GLM-4-Air',
    description: '速度与质量均衡',
    icon: modelIcon,
  },
];

export function ModelSelect({ value, onChange }: { value: ModelId; onChange: (value: ModelId) => void }) {
  return (
    <Select
      value={value}
      options={MODEL_OPTIONS}
      onValueChange={onChange}
      ariaLabel="选择生成模型"
    />
  );
}
