import type { AgentPlan, StepResult } from './agent-plan';
import { resolveArguments } from './agent-plan';
import { AgentFailure } from './agent-store';

type Graph = { nodes: Array<{ id: string; data: Record<string, unknown> }>; edges: Array<{ source: string; target: string }> };
export function verifyPlan(plan: AgentPlan, results: Map<string, StepResult>, graph: Graph) {
  const expected = new Map<string, Record<string, unknown>>();
  const edges: Array<{ source: string; target: string }> = [];
  const patch = (id: string, data: Record<string, unknown>) => expected.set(id, { ...expected.get(id), ...data });
  for (const step of plan.steps) {
    const result = results.get(step.id);
    if (!result) throw new AgentFailure('VERIFICATION_FAILED', `步骤 ${step.id} 没有提交结果`);
    const args = resolveArguments(step, results);
    if (step.tool === 'generate_image') {
      const node = graph.nodes.find(n => n.id === args.nodeId);
      if (!result.generationTaskId || result.generatedNodeId !== args.nodeId || node?.data.generationTaskId !== result.generationTaskId) throw new AgentFailure('VERIFICATION_FAILED', '图片生成任务与目标节点不匹配');
    }
    if (step.tool === 'rename_node') patch(String(args.nodeId), { title: args.title });
    if (step.tool === 'update_node_prompt') {
      const state = (result.nodeStates as Graph['nodes'] | undefined)?.find(n => n.id === args.nodeId)?.data;
      if (!state || !String(state.prompt ?? '').startsWith(String(args.prompt))) throw new AgentFailure('VERIFICATION_FAILED', '修改提示词的提交结果与计划不符');
      patch(String(args.nodeId), { prompt: state.prompt });
      for (const source of (state.referenceNodeIds ?? []) as string[]) edges.push({ source, target: String(args.nodeId) });
    }
    if (step.tool === 'create_nodes') {
      const created = result.createdNodes as { id: string }[];
      const nodes = args.nodes as Array<Record<string, unknown> & { referenceNodeIds: string[] }>;
      if (created?.length !== nodes.length) throw new AgentFailure('VERIFICATION_FAILED', '创建节点数量与计划不符');
      nodes.forEach((node, index) => {
        const id = created[index]!.id;
        const state = (result.nodeStates as Graph['nodes'] | undefined)?.find(n => n.id === id)?.data;
        if (!state || !String(state.prompt ?? '').startsWith(String(node.prompt ?? ''))) throw new AgentFailure('VERIFICATION_FAILED', '创建节点的提示词与计划不符');
        patch(id, { title: node.title, kind: node.kind, content: node.content ?? '', prompt: state.prompt ?? '' });
        node.referenceNodeIds.forEach(source => edges.push({ source, target: id }));
      });
    }
    if (step.tool === 'connect_nodes') {
      edges.push(...args.connections as typeof edges);
      // Connecting appends reference tokens to the prompt. Its committed state
      // supersedes a prompt supplied by an earlier step in the same plan.
      for (const node of (result.nodeStates ?? []) as Graph['nodes']) patch(node.id, { prompt: node.data.prompt ?? '' });
    }
  }
  for (const [id, fields] of expected) {
    const actual = graph.nodes.find(n => n.id === id);
    if (!actual || Object.entries(fields).some(([key, value]) => actual.data[key] !== value)) throw new AgentFailure('VERIFICATION_FAILED', `节点 ${id} 的实际结果与计划不符`);
  }
  for (const edge of edges) {
    const target = graph.nodes.find(node => node.id === edge.target);
    if (!graph.edges.some(e => e.source === edge.source && e.target === edge.target) ||
      !Array.isArray(target?.data.referenceNodeIds) || !target.data.referenceNodeIds.includes(edge.source)) throw new AgentFailure('VERIFICATION_FAILED', '计划中的依赖连接或引用信息未完成');
  }
}

export function assertPreconditions(tool: string, args: Record<string, unknown>, baseline: Graph, results: Map<string, StepResult>, current: Graph) {
  const states = new Map(baseline.nodes.map(n => [n.id, n.data]));
  for (const result of results.values()) for (const node of (result.nodeStates ?? []) as Graph['nodes']) {
    const before = states.get(node.id);
    if (result.createdNodes) states.set(node.id, node.data);
    else if (result.renamedNodeId) states.set(node.id, { ...before, title: node.data.title });
    else states.set(node.id, { ...before, prompt: node.data.prompt, referenceNodeIds: node.data.referenceNodeIds });
  }
  const check = (id: string, fields: string[]) => {
    const before = states.get(id);
    const actual = current.nodes.find(n => n.id === id)?.data;
    const value = (data: Record<string, unknown>, key: string) => data[key] ?? ({ uploaded: false, generationDetached: false, prompt: '', content: '', referenceNodeIds: [] } as Record<string, unknown>)[key] ?? null;
    if (!before || !actual || fields.some(key => JSON.stringify(value(before, key)) !== JSON.stringify(value(actual, key)))) throw new AgentFailure('PRECONDITION_CHANGED', '目标节点已被其他操作修改，请根据最新画布发送新指令');
  };
  if (tool === 'rename_node') check(String(args.nodeId), ['title']);
  if (tool === 'generate_image') {
    check(String(args.nodeId), ['kind', 'prompt', 'referenceNodeIds', 'model', 'uploaded', 'generationSize', 'generationQuality', 'assetId', 'generationTaskId', 'generationRequestId', 'generationDetached']);
    const target = current.nodes.find(n => n.id === args.nodeId);
    for (const id of (target?.data.referenceNodeIds ?? []) as string[]) {
      const source = current.nodes.find(n => n.id === id);
      check(id, source?.data.kind === 'image' ? ['kind', 'assetId', 'url'] : ['kind', 'content', 'prompt']);
    }
  }
  if (tool === 'update_node_prompt') check(String(args.nodeId), ['prompt', 'kind', 'uploaded']);
  if (tool === 'connect_nodes') for (const c of args.connections as { source: string; target: string }[]) { check(c.source, ['kind']); check(c.target, ['kind', 'prompt', 'referenceNodeIds', 'model', 'uploaded']); }
  if (tool === 'create_nodes') for (const n of args.nodes as { referenceNodeIds: string[] }[]) for (const id of n.referenceNodeIds) check(id, ['kind']);
}
