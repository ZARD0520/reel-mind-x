export const CHAT_BUSY_MESSAGE = '当前业务模型繁忙，请稍后再试。';
export const CHAT_FAILURE_MESSAGE = '当前对话暂时无法完成，请稍后再试。';

/** Only return product copy; upstream responses, URLs and stack traces stay private. */
export function chatErrorMessage(error: unknown): string {
  const value = error && typeof error === 'object' ? error as { message?: unknown; status?: unknown; statusCode?: unknown; body?: unknown; name?: unknown } : {};
  const message = typeof error === 'string' ? error : typeof value.message === 'string' ? value.message : '';
  const detail = message + (typeof value.body === 'string' ? value.body : '');
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
