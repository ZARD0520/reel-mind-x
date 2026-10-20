export const kindName: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
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
};
export const time = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
export const number = (value: number) => value.toLocaleString('zh-CN');
