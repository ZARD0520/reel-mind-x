export const MODEL_BUSY_MESSAGE = '模型繁忙，请更换模型或稍后再试';

export const GENERATION_STATUS_LABELS = {
  queued: '排队中',
  submitting: '提交中',
  generating: '生成中',
  saving: '保存中',
  unknown: '结果待确认',
  completed: '已完成',
  failed: '已失败',
} as const;

export function isGenerationActive(status: string): boolean {
  return status !== 'completed' && status !== 'failed';
}
