export const kindName: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  chat: 'Agent 对话',
};
export const statusName: Record<string, string> = {
  queued: '排队中',
  submitting: '提交中',
  generating: '生成中',
  saving: '保存中',
  unknown: '结果待确认',
  completed: '成功',
  failed: '失败',
  held: '冻结中',
  captured: '已扣除',
  refunded: '已退还',
  active: '正常',
  disabled: '已禁用',
  ready: '就绪',
  deleted: '已删除',
};
export const sourceName: Record<string, string> = {
  upload: '上传',
  ai: 'AI 生成',
};
export const time = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
export const number = (value: number) => value.toLocaleString('zh-CN');
/** 后台列表通用筛选参数：search 为用户名模糊搜索；start/end 为本地日期（YYYY-MM-DD），end 含当天 */
export const adminListQuery = (
  page: number,
  filters: { search?: string; start?: string; end?: string; kind?: string; status?: string },
) =>
  new URLSearchParams({
    page: String(page),
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.start ? { start: new Date(`${filters.start}T00:00:00`).toISOString() } : {}),
    ...(filters.end ? { end: new Date(`${filters.end}T23:59:59`).toISOString() } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  }).toString();
