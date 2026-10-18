import type { GenerationTask } from '@reel/contracts';
import { isGenerationActive } from '@reel/contracts/generation';
import type { Edge, Node } from '@xyflow/react';

/** Unknown tasks are paused for manual verification, not actively executing. */
export function generationTasksPollingInterval(
  tasks?: Pick<GenerationTask, 'status'>[],
): 3000 | false {
  return tasks?.some((task) =>
    ['queued', 'submitting', 'generating', 'saving'].includes(task.status),
  )
    ? 3000
    : false;
}

/** Retry errors are internal until exhausted; uncertainty needs an actionable message. */
export function generationFeedbackMessage(data: {
  status?: string;
  error?: string;
  generationStatus?: string;
  generationMessage?: string;
  generationFailureVisible?: boolean;
}) {
  if (data.generationFailureVisible === false && data.generationStatus !== 'unknown') return '';
  if (data.generationStatus === 'unknown')
    return data.generationMessage || '生成结果暂时无法确认，请稍后继续查询';
  if (data.status === 'generating') return '';
  return data.error || (data.status === 'failed' ? '生成失败，请稍后重试' : '');
}

type GenerationNodeData = Record<string, unknown> & {
  kind: string;
  title: string;
  content: string;
  generationRequestId?: string;
  generationTaskId?: string;
  generationAppliedTaskId?: string;
  generationBatchResultsTaskId?: string;
  generationBatchTaskId?: string;
};

/** Reconciliation is deterministic, so refresh and repeated polling cannot duplicate batch outputs. */
export function recoverGenerationTasks<D extends GenerationNodeData>(
  nodes: Node<D>[],
  edges: Edge[],
  tasks: GenerationTask[],
  horizontalGap: (node: Node<D>) => number,
) {
  let nextNodes = nodes;
  let nextEdges = edges;
  for (const task of tasks) {
    const node = nextNodes.find((candidate) => candidate.id === task.nodeId);
    if (
      !node ||
      (node.data.generationRequestId && node.data.generationRequestId !== task.requestId)
    )
      continue;
    const alreadyApplied =
      node.data.generationAppliedTaskId === task.id &&
      !isGenerationActive(task.status) &&
      node.data.generationStatus === task.status &&
      node.data.status !== 'generating';
    if (alreadyApplied && node.data.generationBatchResultsTaskId === task.id) continue;
    const active = isGenerationActive(task.status);
    const successful = task.items.filter((item) => item.status === 'completed' && item.asset);
    const assigned = node.data.generationBatchResultsTaskId === task.id
      ? task.items.find((item) => item.asset && item.asset.id === node.data.assetId)
      : undefined;
    // Keep the existing first-success mapping, but also materialize every failed result.
    const results = assigned
      ? [assigned, ...task.items.filter((item) => item !== assigned)]
      : [...successful, ...task.items.filter((item) => !successful.includes(item))];
    const asset = results[0]?.status === 'completed' ? results[0].asset : undefined;
    const patch = {
      generationTaskId: task.id,
      generationRequestId: task.requestId,
      generationStatus: task.status,
      generationFailureVisible: active || node.data.generationFailureVisible !== false,
      // A failed sibling can be resumable while the rest of a batch is still running.
      // Let the batch finish before exposing recovery actions.
      generationCanResume: task.canResume && (!active || task.status === 'unknown'),
      generationMessage: task.error ?? '',
      generationProgress: task.items.length > 1 ? `${successful.length}/${task.items.length}` : '',
      status: active ? 'generating' : asset ? 'ready' : 'failed',
      error: active || asset ? '' : (results[0]?.error ?? task.error ?? ''),
      generationAppliedTaskId: active ? undefined : task.id,
      ...(!active ? { generationBatchResultsTaskId: task.id } : {}),
      ...(!active && results[0]
        ? {
            assetId: results[0].asset?.id,
            content: asset?.content ?? '',
            url: asset?.url ?? null,
            model: results[0].asset?.model ?? task.model,
            editorProjectId: undefined,
          }
        : {}),
    };
    // Old saved graphs already contain successful outputs; only backfill missing failure nodes.
    const parentPatch = alreadyApplied ? { generationBatchResultsTaskId: task.id } : patch;
    if (Object.entries(parentPatch).some(([key, value]) => node.data[key] !== value)) {
      nextNodes = nextNodes.map((candidate) =>
        candidate.id === node.id
          ? { ...candidate, data: { ...candidate.data, ...parentPatch } }
          : candidate,
      );
    }
    if (!active) {
      const outputs = results
        .slice(1)
        .map(
          (item, index): Node<D> => ({
            id: item.asset?.id ?? item.id,
            type: node.type,
            position: {
              x: node.position.x + horizontalGap(node) * (index + 1),
              y: node.position.y,
            },
            data: {
              ...node.data,
              ...patch,
              title: `${node.data.title} ${index + 2}`,
              generationTaskId: undefined,
              generationRequestId: undefined,
              generationStatus: undefined,
              generationAppliedTaskId: undefined,
              generationBatchResultsTaskId: undefined,
              generationBatchTaskId: task.id,
              generationCanResume: false,
              generationMessage: '',
              generationProgress: '',
              generationCount: 1,
              assetId: item.asset?.id,
              content: item.status === 'completed' ? (item.asset?.content ?? '') : '',
              url: item.status === 'completed' ? item.asset?.url : null,
              model: item.asset?.model ?? task.model,
              status: item.status === 'completed' && item.asset ? 'ready' : 'failed',
              error: item.status === 'completed' && item.asset ? '' : (item.error ?? '生成失败，请稍后重试'),
            } as D,
          }),
        );
      // A resumed save updates its existing output, without resetting user edits or restoring deletions.
      const updates = new Map(outputs.map((output) => [output.id, output]));
      if (!alreadyApplied) nextNodes = nextNodes.map((existing) => {
        const output = updates.get(existing.id);
        if (!output || existing.data.generationBatchTaskId !== task.id ||
            existing.data.generationTaskId || existing.data.generationRequestId ||
            (existing.data.status === output.data.status && existing.data.assetId === output.data.assetId))
          return existing;
        return { ...existing, data: { ...existing.data, ...output.data, title: existing.data.title } };
      });
      const additions = outputs.filter((candidate) =>
        !nextNodes.some((existing) => existing.id === candidate.id) &&
        node.data.generationBatchResultsTaskId !== task.id &&
        (!alreadyApplied || candidate.data.status === 'failed'),
      );
      if (additions.length) {
        nextNodes = [...nextNodes, ...additions];
        const incoming = nextEdges.filter((edge) => edge.target === node.id);
        nextEdges = [
          ...nextEdges,
          ...additions.flatMap((child) =>
            incoming.map((edge) => ({ ...edge, id: `${edge.id}-${child.id}`, target: child.id })),
          ),
        ];
      }
    }
  }
  return { nodes: nextNodes, edges: nextEdges };
}
