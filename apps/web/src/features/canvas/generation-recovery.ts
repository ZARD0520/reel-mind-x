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
    if (
      node.data.generationAppliedTaskId === task.id &&
      !isGenerationActive(task.status) &&
      node.data.generationStatus === task.status &&
      node.data.status !== 'generating'
    )
      continue;
    const active = isGenerationActive(task.status);
    const successful = task.items.filter((item) => item.status === 'completed' && item.asset);
    const asset = successful[0]?.asset;
    const patch = {
      generationTaskId: task.id,
      generationRequestId: task.requestId,
      generationStatus: task.status,
      generationFailureVisible: active || node.data.generationFailureVisible !== false,
      generationCanResume: task.canResume,
      generationMessage: task.error ?? '',
      generationProgress: task.items.length > 1 ? `${successful.length}/${task.items.length}` : '',
      status: active ? 'generating' : asset ? 'ready' : 'failed',
      error: active ? '' : (task.error ?? ''),
      generationAppliedTaskId: active ? undefined : task.id,
      ...(!active && asset
        ? {
            assetId: asset.id,
            content: asset.content ?? '',
            url: asset.url,
            model: asset.model ?? task.model,
            editorProjectId: undefined,
          }
        : {}),
    };
    if (Object.entries(patch).some(([key, value]) => node.data[key] !== value)) {
      nextNodes = nextNodes.map((candidate) =>
        candidate.id === node.id
          ? { ...candidate, data: { ...candidate.data, ...patch } }
          : candidate,
      );
    }
    if (!active && node.data.generationAppliedTaskId !== task.id) {
      const additions = successful
        .slice(1)
        .map(
          (item, index): Node<D> => ({
            id: item.asset!.id,
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
              generationCanResume: false,
              generationMessage: '',
              generationProgress: '',
              assetId: item.asset!.id,
              content: item.asset!.content ?? '',
              url: item.asset!.url,
              model: item.asset!.model ?? task.model,
              status: 'ready',
              error: '',
            } as D,
          }),
        )
        .filter((candidate) => !nextNodes.some((existing) => existing.id === candidate.id));
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
