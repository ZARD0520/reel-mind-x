import { z } from 'zod/v3';
import { toolSchemas } from './canvas-tools.service';

const nodeRef = z.union([z.string().min(1).max(100), z.object({ stepId: z.string().min(1).max(40), index: z.number().int().min(0).max(19) }).strict()]);
const base = { id: z.string().trim().min(1).max(40), description: z.string().min(1).max(200) };
const createNode = toolSchemas.create_nodes.shape.nodes.element.extend({ referenceNodeIds: z.array(nodeRef).max(8).default([]) }).refine(node => node.kind !== 'video' || node.prompt.length <= 512, '视频节点提示词最多512字');
const stepSchema = z.discriminatedUnion('tool', [
  z.object({ ...base, tool: z.literal('rename_node'), arguments: toolSchemas.rename_node.omit({ expectedRevision: true, nodeId: true }).extend({ nodeId: nodeRef }) }).strict(),
  z.object({ ...base, tool: z.literal('update_node_prompt'), arguments: toolSchemas.update_node_prompt.omit({ expectedRevision: true, nodeId: true }).extend({ nodeId: nodeRef }) }).strict(),
  z.object({ ...base, tool: z.literal('create_nodes'), arguments: z.object({ nodes: z.array(createNode).min(1).max(20) }).strict() }).strict(),
  z.object({ ...base, tool: z.literal('connect_nodes'), arguments: z.object({ connections: z.array(z.object({ source: nodeRef, target: nodeRef }).strict()).min(1).max(40) }).strict() }).strict(),
]);
export const PlanSchema = z.object({
  mode: z.enum(['execute', 'answer', 'clarify']), goal: z.string().min(1).max(500),
  answer: z.string().max(6000).nullish().transform(value => value ?? ''), steps: z.array(stepSchema).max(12),
}).strict().superRefine((plan, ctx) => {
  if (plan.mode === 'execute' ? !plan.steps.length : plan.steps.length || !plan.answer.trim()) ctx.addIssue({ code: 'custom', message: 'execute必须有步骤；answer/clarify必须无步骤并提供answer' });
  if (new Set(plan.steps.map(s => s.id)).size !== plan.steps.length) ctx.addIssue({ code: 'custom', message: '步骤ID不能重复' });
});
export type AgentPlan = z.infer<typeof PlanSchema>;
export type PlanStep = AgentPlan['steps'][number];
export type StepResult = Record<string, unknown>;

/** Explicit literal slots belong to the request, not to model paraphrasing. */
export function bindRequestLiterals(plan: AgentPlan, request: string, explicitNodeIds = new Set<string>()) {
  const renames = plan.steps.filter(step => step.tool === 'rename_node');
  if (renames.length !== 1) return;
  const source = request.split('\n\n用户引用的当前画布节点：')[0]!;
  const matches = [...source.matchAll(/(?:重命名(?:为|成)|改名(?:为|成)|(?:名称|名字)(?:更改|修改|改|设置)?(?:为|成))\s*(?:「([^」]+)」|“([^”]+)”|"([^"]+)"|'([^']+)'|([^，,。；;\n]+))/g)];
  if (matches.length !== 1) return;
  const match = matches[0]!;
  const title = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '').trim();
  if (title && title.length <= 200) {
    renames[0]!.arguments.title = title;
    if (plan.steps.length === 1 && explicitNodeIds.size === 1) renames[0]!.arguments.nodeId = [...explicitNodeIds][0]!;
  }
}

export function validateRequestBounds(plan: AgentPlan, request: string) {
  if (plan.mode !== 'execute') return;
  const source = request.split('\n\n用户引用的当前画布节点：')[0]!;
  const pattern = /(?:创建|新增|添加)\s*(?:且只创建\s*)?([一二三四五六七八九十两\d]+)\s*(?:个|张|段)?\s*(?:新的?)?\s*(文本|图片|视频|音频|分镜)(?:节点)?/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) return;
  const match = matches[0]!;
  // Mixed quantity requests need a richer plan; do not interpret one fragment
  // as a total bound for the entire request.
  if (/[一二三四五六七八九十两\d]+\s*(?:个|张|段)/.test(source.replace(match[0], ''))) return;
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const count = /^\d+$/.test(match[1]!) ? Number(match[1]) : match[1]!.includes('十')
    ? (digits[match[1]!.split('十')[0]!] ?? 1) * 10 + (digits[match[1]!.split('十')[1]!] ?? 0) : digits[match[1]!];
  if (!count) return;
  const kind = ({ 文本: 'text', 图片: 'image', 视频: 'video', 音频: 'audio', 分镜: 'image' } as Record<string, string>)[match[2]!];
  const nodes = plan.steps.flatMap(step => step.tool === 'create_nodes' ? step.arguments.nodes : []);
  if (nodes.length !== count || nodes.some(node => node.kind !== kind)) throw new Error(`用户明确要求只创建${count}个${kind}节点，计划不能额外创建其他节点；引用已有素材时不要复制来源节点`);
}

export function bindRequestReferences(plan: AgentPlan, request: string, explicitNodeIds: Set<string>) {
  const source = request.split('\n\n用户引用的当前画布节点：')[0]!;
  const creates = plan.steps.filter(step => step.tool === 'create_nodes');
  // For the unambiguous single-source/single-output command, dependency IDs
  // come from the request. The model only needs to plan the new node's content.
  if (/引用/.test(source) && explicitNodeIds.size === 1 && creates.length === 1 && creates[0]!.arguments.nodes.length === 1) {
    creates[0]!.arguments.nodes[0]!.referenceNodeIds = [[...explicitNodeIds][0]!];
  }
}

// Tool schemas remain the source of truth. The planner receives their JSON
// schemas separately; its own protocol intentionally excludes revision tokens.
const PLAN_FORMAT: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['mode', 'goal', 'answer', 'steps'], properties: {
    mode: { type: 'string', enum: ['execute', 'answer', 'clarify'] },
    goal: { type: 'string', minLength: 1, maxLength: 500 },
    answer: { type: ['string', 'null'], maxLength: 6000 },
    steps: { type: 'array', maxItems: 12 },
  },
};

export function planningProtocol(definitions: Array<{ name: string; description?: string; inputSchema: unknown }>) {
  const reference = { anyOf: [{ type: 'string', minLength: 1, maxLength: 100 }, { type: 'object', additionalProperties: false, required: ['stepId', 'index'], properties: { stepId: { type: 'string' }, index: { type: 'integer', minimum: 0, maximum: 19 } } }] };
  const tools = definitions.filter(t => t.name !== 'get_canvas_context').map(t => {
    const schema = JSON.parse(JSON.stringify(t.inputSchema));
    delete schema.properties.expectedRevision;
    schema.required = (schema.required ?? []).filter((name: string) => name !== 'expectedRevision');
    if (schema.properties.nodeId) schema.properties.nodeId = reference;
    if (t.name === 'create_nodes') schema.properties.nodes.items.properties.referenceNodeIds.items = reference;
    if (t.name === 'connect_nodes') {
      schema.properties.connections.items.properties.source = reference;
      schema.properties.connections.items.properties.target = reference;
    }
    return { name: t.name, description: t.description, schema };
  });
  const format = JSON.parse(JSON.stringify(PLAN_FORMAT)) as Record<string, unknown>;
  const properties = format.properties as Record<string, Record<string, unknown>>;
  properties.steps!.items = { oneOf: tools.map(t => ({ type: 'object', description: t.description, additionalProperties: false, required: ['id', 'description', 'tool', 'arguments'], properties: {
    id: { type: 'string' }, description: { type: 'string' }, tool: { type: 'string', const: t.name }, arguments: t.schema,
  } })) };
  return format;
}

export function resolveArguments(step: PlanStep, results: Map<string, StepResult>): Record<string, unknown> {
  const resolve = (ref: z.infer<typeof nodeRef>): string => {
    if (typeof ref === 'string') return ref;
    const nodes = results.get(ref.stepId)?.createdNodes as { id: string }[] | undefined;
    const id = nodes?.[ref.index]?.id;
    if (!id) throw new Error(`无法解析步骤引用：${ref.stepId}[${ref.index}]`);
    return id;
  };
  switch (step.tool) {
    case 'rename_node': case 'update_node_prompt': return { ...step.arguments, nodeId: resolve(step.arguments.nodeId) };
    case 'create_nodes': return { nodes: step.arguments.nodes.map(n => ({ ...n, referenceNodeIds: n.referenceNodeIds.map(resolve) })) };
    case 'connect_nodes': return { connections: step.arguments.connections.map(c => ({ source: resolve(c.source), target: resolve(c.target) })) };
  }
}

export function validateReferences(plan: AgentPlan, nodeIds: Set<string>) {
  const created = new Map<string, number>();
  const check = (ref: z.infer<typeof nodeRef>) => {
    if (typeof ref === 'string') {
      if (!nodeIds.has(ref)) throw new Error(`计划引用了不存在或未读取的节点：${ref}`);
    } else if (ref.index >= (created.get(ref.stepId) ?? 0)) throw new Error('节点引用必须指向前面创建步骤的有效索引');
  };
  for (const step of plan.steps) {
    if (step.tool === 'create_nodes') {
      step.arguments.nodes.forEach(n => n.referenceNodeIds.forEach(check));
      created.set(step.id, step.arguments.nodes.length);
    } else if (step.tool === 'connect_nodes') step.arguments.connections.forEach(c => { check(c.source); check(c.target); });
    else check(step.arguments.nodeId);
  }
}
