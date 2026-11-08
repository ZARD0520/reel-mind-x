export const AGENT_ACTIVE_STATES = ['planning', 'executing', 'verifying'] as const;
export const AGENT_TERMINAL_STATES = ['completed', 'awaiting_input', 'completed_with_errors'] as const;
export const AGENT_DELIVERABLE_STATES = [...AGENT_TERMINAL_STATES, 'waiting_generation'] as const;
export const AGENT_INTERRUPTED_STATES = ['interrupted', 'cancelled', 'partial', 'failed'] as const;
export const AGENT_RECOVERABLE_ERRORS = ['CANCELLED', 'STREAM_CLOSED', 'LEASE_EXPIRED', 'LEASE_LOST', 'RUN_TIMEOUT', 'TRANSIENT'] as const;

export function agentCanRecover(status: string, errorCode?: string | null) {
  return (AGENT_ACTIVE_STATES as readonly string[]).includes(status) ||
    (AGENT_INTERRUPTED_STATES as readonly string[]).includes(status) && (AGENT_RECOVERABLE_ERRORS as readonly string[]).includes(errorCode ?? '');
}

export function agentHasBackgroundWork(run: { status: string; errorCode?: string | null; delivered: boolean; hasGeneration: boolean }) {
  return run.delivered && run.hasGeneration && (run.status === 'waiting_generation' || agentCanRecover(run.status, run.errorCode));
}
