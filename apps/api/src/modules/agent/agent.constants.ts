/**
 * 队列与任务名集中定义，禁止魔法字符串。
 * 约定：DLQ（死信队列）命名为 `<name>-dlq`。
 */
export enum QueueNames {
  AGENT = 'agent',
  AGENT_DLQ = 'agent-dlq',
}

export const JobNames = {
  RUN_AGENT: 'run-agent',
} as const;

export type JobName = (typeof JobNames)[keyof typeof JobNames];
