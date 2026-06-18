import type { RenderQuality } from '@reel/contracts';

/** 渲染队列与任务名（禁止魔法字符串；DLQ 约定 `<name>-dlq`）。 */
export enum QueueNames {
  RENDER = 'render',
  RENDER_DLQ = 'render-dlq',
}

export const JobNames = {
  RENDER_PROJECT: 'render-project',
} as const;

export interface RenderJobPayload {
  renderJobId: string;
  projectId: string;
  quality: RenderQuality;
}
