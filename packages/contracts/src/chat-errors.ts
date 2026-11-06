export const CHAT_BUSY_MESSAGE = '当前业务模型繁忙，请稍后再试。';
export const CHAT_FAILURE_MESSAGE = '当前对话暂时无法完成，请稍后再试。';

/** Only return product copy; upstream responses, URLs and stack traces stay private. */
export function chatErrorMessage(error: unknown): string {
  const value = error && typeof error === 'object' ? error as { message?: unknown; status?: unknown; statusCode?: unknown; body?: unknown; name?: unknown; code?: unknown } : {};
  const message = typeof error === 'string' ? error : typeof value.message === 'string' ? value.message : '';
  const detail = message + (typeof value.body === 'string' ? value.body : '');
  const agentErrors: Record<string, string> = {
    CONTEXT_BUDGET: '本次输入或引用内容过多，请减少后重试。',
    PRECONDITION_CHANGED: '目标节点已发生变化，请根据最新画布重新发送指令。',
    VERIFICATION_FAILED: '执行结果未完全通过核验，已完成的操作已保留，请检查画布。',
    RUN_TIMEOUT: '本轮任务已超时，已完成的操作已保留，可以恢复任务。',
    LEASE_LOST: '当前任务执行权已失效，请刷新任务状态后恢复。',
    INVALID_PLAN: '本次任务未能形成有效计划，尚未修改画布，请调整指令后重试。',
    REQUEST_BUDGET: '本轮模型请求预算已用完，已保存任务状态，请稍后恢复。',
  };
  if (typeof value.code === 'string' && agentErrors[value.code]) return agentErrors[value.code]!;
  if (Object.values(agentErrors).includes(message)) return message;
  if (/积分不足|余额不足/.test(detail)) return '积分不足，请补充积分后再试。';
  if (/同时最多|并发.*限制/.test(detail)) return '当前任务较多，请稍后再试。';
  if (/每日.*额度|每日.*上限/.test(detail)) return '今日使用额度已达上限，请稍后再试。';
  if (value.status === 429 || value.statusCode === 429 || /\b429\b|1305|模型.*繁忙|访问量过大/.test(detail)) return CHAT_BUSY_MESSAGE;
  if (value.status === 401 && value.name !== 'LlmError') return '登录状态已失效，请重新登录。';
  if (/Failed to fetch|fetch failed|NetworkError|网络.*错误|网络.*异常/.test(detail)) return '网络连接异常，请稍后再试。';
  if (message === '画布同步失败，请刷新页面查看已执行结果') return '画布同步失败，请刷新页面查看已执行结果。';
  const safe = [CHAT_FAILURE_MESSAGE, '积分不足，请补充积分后再试。', '当前任务较多，请稍后再试。', '今日使用额度已达上限，请稍后再试。', '登录状态已失效，请重新登录。', '网络连接异常，请稍后再试。', '画布同步失败，请刷新页面查看已执行结果。'];
  return safe.includes(message) ? message : CHAT_FAILURE_MESSAGE;
}
