import type { RenderFailure, RenderFailureCategory, RenderStage } from '@reel/contracts';

const MAX_ERROR_DETAIL_LENGTH = 1600;

function compactDetail(value: string): string {
  const compact = value
    .replace(/\u0000/g, '')
    .replace(/\r/g, '')
    .trim();
  return compact.length > MAX_ERROR_DETAIL_LENGTH
    ? compact.slice(-MAX_ERROR_DETAIL_LENGTH)
    : compact;
}

export class RenderPipelineError extends Error {
  constructor(
    readonly code: string,
    readonly category: RenderFailureCategory,
    readonly stage: RenderStage,
    readonly retryable: boolean,
    readonly userMessage: string,
    readonly technicalDetail: string | null = null,
  ) {
    super(userMessage);
    this.name = 'RenderPipelineError';
  }
}

export class RenderCancelledError extends RenderPipelineError {
  constructor(stage: RenderStage) {
    super('USER_CANCELLED', 'cancelled', stage, false, '导出已由用户取消');
    this.name = 'RenderCancelledError';
  }
}

export function classifyRenderError(error: unknown, stage: RenderStage): RenderFailure {
  if (error instanceof RenderPipelineError) {
    return {
      code: error.code,
      category: error.category,
      stage: error.stage,
      level:
        error instanceof RenderCancelledError
          ? 'cancelled'
          : error.retryable
            ? 'retryable'
            : 'fatal',
      retryable: error.retryable,
      message: error.userMessage,
      detail: error.technicalDetail ? compactDetail(error.technicalDetail) : null,
    };
  }

  const detail = error instanceof Error ? error.message : String(error);
  const lower = detail.toLowerCase();
  if (lower.includes('no space left on device') || lower.includes('enospc')) {
    return {
      code: 'STORAGE_FULL',
      category: 'storage',
      stage,
      level: 'fatal',
      retryable: false,
      message: '导出存储空间不足，请清理空间后重新导出',
      detail: compactDetail(detail),
    };
  }
  if (lower.includes('permission denied') || lower.includes('eacces')) {
    return {
      code: 'STORAGE_PERMISSION_DENIED',
      category: 'storage',
      stage,
      level: 'fatal',
      retryable: false,
      message: '导出目录无法写入，请检查服务器存储权限',
      detail: compactDetail(detail),
    };
  }

  return {
    code: 'RENDER_INTERNAL_ERROR',
    category: 'system',
    stage,
    level: 'retryable',
    retryable: true,
    message: '导出服务发生临时内部错误，系统将自动重试',
    detail: compactDetail(detail),
  };
}

export function exhaustedFailure(failure: RenderFailure): RenderFailure {
  if (!failure.retryable) return failure;
  return {
    ...failure,
    level: 'exhausted',
    message: `${failure.message.replace(/，系统将自动重试$/, '')}；自动重试后仍未恢复`,
  };
}

export function queueFailure(error: unknown): RenderFailure {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    code: 'QUEUE_SUBMIT_FAILED',
    category: 'queue',
    stage: 'queued',
    level: 'exhausted',
    retryable: true,
    message: '任务未能提交到导出队列，请稍后重新导出',
    detail: compactDetail(detail),
  };
}
