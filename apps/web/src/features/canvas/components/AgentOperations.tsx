import { Check, Loader2, AlertCircle } from 'lucide-react';
import type { AgentToolProgress } from '../chat-types';

export function AgentOperations({ operations, runStatus }: { operations: AgentToolProgress[]; runStatus?: string }) {
  const latest = [...new Map(operations.map(operation => [operation.id, operation])).values()];
  if (!latest.length) return null;
  return <div aria-label="Agent 执行记录" aria-live="polite" className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-[#b9b9bd]">
    {latest.map(operation => {
      const interrupted = operation.status === 'running' && !!runStatus && runStatus !== 'running';
      return <div key={`${operation.runId}-${operation.id}`} className="flex items-start gap-2">
      {operation.status === 'running' && !interrupted ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : operation.status === 'failed' || interrupted ? <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-400" /> : <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
      <span>{operation.title} · {interrupted ? '已中断' : operation.status === 'running' ? '执行中' : operation.status === 'failed' ? '失败' : '已完成'}
        {operation.status === 'failed' && operation.result && <span className="mt-1 block break-words text-red-400">{typeof operation.result.message === 'string' ? operation.result.message : JSON.stringify(operation.result.message)}</span>}
      </span>
    </div>; })}
  </div>;
}
