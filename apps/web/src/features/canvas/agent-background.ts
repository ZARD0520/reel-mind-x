import type { GenerationTask } from '@reel/contracts';
import type { Conversation } from './chat-types';

/** A resumed media task can advance before the background executor has updated
 * its old terminal run. Keep observing until the run's receipts catch up. */
export function hasPendingAgentMedia(conversation?: Conversation, tasks: GenerationTask[] = []) {
  return conversation?.agentRuns?.some(run => run.backgroundPending || run.status === 'waiting_generation' || run.steps?.some(step => {
    const task = tasks.find(item => item.id === step.generationTaskId);
    return task && (task.revision ?? 0) > (step.generationRevision ?? 0);
  })) ?? false;
}
