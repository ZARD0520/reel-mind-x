type Data = Record<string, unknown>;
const text = (value: unknown) => typeof value === 'string' && value ? value : undefined;
const revision = (data: Data) => typeof data.generationRevision === 'number' ? data.generationRevision : 0;
const identified = (data: Data) => !!(text(data.generationTaskId) || text(data.generationRequestId));
const sameTask = (a: Data, b: Data) => a.generationTaskId && b.generationTaskId
  ? a.generationTaskId === b.generationTaskId : a.generationRequestId && b.generationRequestId
    ? a.generationRequestId === b.generationRequestId : !identified(a) && !identified(b);
const status = (data: Data) => data.generationStatus ?? (data.status === 'ready' ? 'completed' : data.status);
const terminal = (data: Data) => ['completed', 'failed'].includes(String(status(data)));
const started = (data: Data) => typeof data.generationStartedAt === 'string' ? Date.parse(data.generationStartedAt) : NaN;
const taskOrder = (a: Data, b: Data): number | null => {
  const left = started(a), right = started(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  if (left !== right) return left > right ? 1 : -1;
  const first = text(a.generationTaskId), second = text(b.generationTaskId);
  return first && second && first !== second ? first > second ? 1 : -1 : 0;
};

export function generationSnapshot<Status extends string>(task: { id: string; requestId: string; revision?: number; createdAt?: Date | string | number; status: Status }) {
  const date = task.createdAt === undefined ? NaN : new Date(task.createdAt).getTime();
  return { generationTaskId: task.id, generationRequestId: task.requestId, generationRevision: task.revision ?? 0,
    generationStatus: task.status, ...(Number.isFinite(date) ? { generationStartedAt: new Date(date).toISOString() } : {}),
  };
}

/** Eligibility to project an observed task onto a node. Task identity is a
 * fence; revisions only order snapshots within the same task. */
export function acceptsGenerationSnapshot(current: Data, incoming: Data, requireBoundTask = false): boolean {
  if (current.generationDetached) return false;
  if (requireBoundTask && current.generationTaskId !== incoming.generationTaskId) return false;
  if (current.generationRequestId && current.generationRequestId !== incoming.generationRequestId) return false;
  if (sameTask(current, incoming)) {
    if (revision(current) > revision(incoming)) return false;
    if (revision(current) === revision(incoming) && terminal(current) && !terminal(incoming) && current.generationAppliedTaskId === incoming.generationTaskId) return false;
  } else if ((taskOrder(current, incoming) ?? 0) > 0) return false;
  return true;
}

const fields = ['generationTaskId', 'generationRequestId', 'generationStartedAt', 'generationRevision', 'generationStatus',
  'generationAppliedTaskId', 'generationBatchResultsTaskId', 'generationBatchTaskId', 'generationCanResume', 'generationMessage', 'generationProgress',
  'status', 'error', 'assetId', 'url', 'content', 'model', 'editorProjectId'] as const;
const editableAfterCompletion = new Set<string>(['content', 'model', 'editorProjectId']);

/** Merge the result as one cohort. Independent per-field merging can combine
 * a new task ID with an old task's URL/status, or decrease a known revision. */
export function mergeGenerationSnapshot(base: Data, local: Data, remote: Data, merged: Data): Data {
  if (!identified(base) && !identified(local) && !identified(remote)) return merged;
  let winner: Data;
  const localIdentityChanged = !sameTask(base, local), remoteIdentityChanged = !sameTask(base, remote);
  if (local.generationDetached && !base.generationDetached) winner = local;
  else if (localIdentityChanged && !remoteIdentityChanged) winner = local;
  else if (remoteIdentityChanged && !localIdentityChanged) winner = remote;
  else if (!sameTask(local, remote)) {
    winner = (taskOrder(local, remote) ?? 0) > 0 ? local : remote;
  } else if (revision(local) !== revision(remote)) winner = revision(local) > revision(remote) ? local : remote;
  else if (terminal(local) !== terminal(remote)) winner = terminal(local) ? local : remote;
  else winner = remote;
  const output = { ...merged };
  const stableCompleted = sameTask(base, winner) && revision(base) === revision(winner) && terminal(base);
  for (const key of fields) {
    if (stableCompleted && editableAfterCompletion.has(key)) continue;
    if (Object.hasOwn(winner, key) && winner[key] !== undefined) output[key] = winner[key];
    else delete output[key];
  }
  return output;
}
