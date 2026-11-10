import { z } from 'zod/v3';
import { toolSchemas } from './canvas-tools.service';

const nodeRef = z.union([z.string().min(1).max(100), z.object({ stepId: z.string().min(1).max(40), index: z.number().int().min(0).max(19) }).strict()]);
const base = { id: z.string().trim().min(1).max(40), description: z.string().min(1).max(200) };
const createNode = toolSchemas.create_nodes.shape.nodes.element.extend({ referenceNodeIds: z.array(nodeRef).max(8).default([]) }).refine(node => node.kind !== 'video' || node.prompt.length <= 512, '视频节点提示词最多512字');
const stepSchema = z.discriminatedUnion('tool', [
  z.object({ ...base, tool: z.literal('generate_image'), arguments: toolSchemas.generate_image.omit({ expectedRevision: true, nodeId: true }).extend({ nodeId: nodeRef }) }).strict(),
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

/** Resolve an explicitly quoted rename source without guessing from selection
 * or conversation history. Creation + rename plans use step references instead. */
export function namedRenameTarget(request: string, nodes: Array<{ id: string; data: Record<string, unknown> }>) {
  const instruction = request.split('\n\n用户引用的当前画布节点：')[0]!;
  const positiveCreation = instruction.replace(/(?:不要|禁止|不用|无需|不需要|不许|不能|别)\s*(?:再|额外)?(?:创建|新建|新增|添加)/g, '');
  if (!/重命名|改名/.test(instruction) || /创建|新建|新增|添加/.test(positiveCreation)) return undefined;
  const matches = [...instruction.matchAll(/(?:把|将|对|给|重命名)\s*(?:名为|名称为|名字为|叫做|叫)?\s*(?:「([^」]+)」|“([^”]+)”|"([^"]+)"|'([^']+)')/g)];
  if (matches.length !== 1) return undefined;
  const match = matches[0]!;
  const title = match[1] ?? match[2] ?? match[3] ?? match[4]!;
  return { title, nodeIds: nodes.filter(node => node.data.title === title).map(node => node.id) };
}

/** Escape literal string control characters and repair closing delimiters;
 * never invent fields, values or missing inner syntax. */
export function parsePlanJson(text: string): unknown {
  let normalizeControls = false;
  try { return JSON.parse(text); }
  catch (error) { normalizeControls = /control character/.test(String(error)); }
  if (normalizeControls) {
    let normalized = '', quotedString = false, escapedChar = false;
    for (const char of text) {
      if (quotedString && !escapedChar && char.charCodeAt(0) < 32) { normalized += JSON.stringify(char).slice(1, -1); continue; }
      normalized += char;
      if (escapedChar) { escapedChar = false; continue; }
      if (quotedString && char === '\\') escapedChar = true;
      else if (char === '"') quotedString = !quotedString;
    }
    text = normalized;
  }
  try { return JSON.parse(text); } catch (original) {
    // Some providers append a stray closing string/container suffix to an
    // otherwise complete object (e.g. ...]}"}). Only discard that punctuation
    // suffix: never extract an object from prose or ignore a second JSON value.
    let depth = 0, inString = false, escape = false;
    if (text.trimStart().startsWith('{')) for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (inString) {
        if (escape) escape = false;
        else if (char === '\\') escape = true;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) {
          if (/^"[\]}\s]*$/.test(text.slice(index + 1).trim())) return JSON.parse(text.slice(0, index + 1));
          break;
        }
      }
    }
    const prefix = text.replace(/[\]}\s]+$/, '');
    const stack: string[] = [];
    let quoted = false;
    let escaped = false;
    for (const char of prefix) {
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{' || char === '[') stack.push(char === '{' ? '}' : ']');
      else if ((char === '}' || char === ']') && stack.pop() !== char) throw original;
    }
    if (quoted || !prefix.trimStart().startsWith('{') || !stack.length || stack.length > 32) throw original;
    // JSON.parse and the complete strict plan schema still have to succeed.
    return JSON.parse(prefix + stack.reverse().join(''));
  }
}

/** The current instruction grants writes; history and attached node text do not. */
export function requestIsReadOnly(request: string) {
  const text = request.split('\n\n用户引用的当前画布节点：')[0]!.trim();
  const deny = /(?:不要|禁止|不许|不能|无需|不用|不需要)\s*(?:实际|直接|自动)?(?:修改|更改|改动|编辑|操作)(?:任何|当前|这个|此)?画布|(?:不要|禁止|不许|无需|不用|不需要)\s*执行(?:任何|实际)?(?:操作|计划|步骤)?/;
  if (deny.test(text) || /只(?:回答|分析|解释|讨论|查看)(?:数量|问题|原因|内容|建议|方法|步骤|流程|教程|一下|即可|就好|[，。！？\s]|$)/.test(text)) return true;
  const mutation = /创建|新增|添加|修改|更改|改为|改成|改名|重命名|命名|起名|取名|更新|连接|连线|拆分|拆成|改写|扩写|续写|生成|制作|执行|操作|优化|润色|转换|整理|设计|调整|做(?:一|个|套)|来(?:一|个|段)|换.{0,12}(?:名|提示词)/;
  // Asking how/why an operation works does not authorize repeating it. A
  // separate affirmative clause can still request an action in the same turn.
  const explanation = /为什么|为何|怎么回事|什么是|是什么|哪些|(?:怎么|如何).{0,60}(?:创建|修改|更改|改名|重命名|生成|使用|操作|连接|连线|出图)/.test(text);
  const affirmativeClause = /(?:^|[，。；,;！？!?])\s*(?:请|帮我|麻烦|然后|接着|再|并).{0,80}(?:创建|新增|添加|修改|更改|改名|重命名|更新|连接|拆分|生成|制作|执行|优化)/.test(text);
  const statusQuestion = /(?:好了吗|好了没|完成了吗|完成了没|成功了吗|成功了没|创建了吗|改了吗|做了吗)[?？]?$/.test(text);
  const question = /[?？]|几个|多少|为什么|为何|是什么|什么是|如何|怎么|是否|有没有/.test(text);
  return (explanation || statusQuestion) && !affirmativeClause || question && !mutation.test(text);
}

/** Normalize only an unambiguous discriminator alias, then validate everything. */
export function parsePlanCandidate(value: unknown): AgentPlan {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    const modes = ['execute', 'answer', 'clarify'];
    if (typeof candidate.type === 'string' && modes.includes(candidate.type) &&
      (!Object.hasOwn(candidate, 'mode') || candidate.mode === candidate.type)) {
      const { type, ...rest } = candidate;
      return PlanSchema.parse({ ...rest, mode: type });
    }
  }
  return PlanSchema.parse(value);
}

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

/** Resolve descriptive placeholders only when exactly one prior output fits. */
export function bindCreatedNodeReferences(plan: AgentPlan, nodeIds: Set<string>) {
  const created: Array<{ stepId: string; index: number }> = [];
  const bind = (ref: z.infer<typeof nodeRef>): z.infer<typeof nodeRef> => {
    if (typeof ref !== 'string' || nodeIds.has(ref)) return ref;
    const mentions = (stepId: string) => ref === stepId || ref.startsWith(`${stepId}[`) ||
      ref.includes(`${stepId}步骤`) || ref.includes(`步骤${stepId}`) || ref.includes(`${stepId} step`) || ref.includes(`step ${stepId}`);
    const mentionedSteps = plan.steps.filter(step => mentions(step.id));
    const named = created.filter(output => ref === output.stepId ||
      ref === `${output.stepId}[${output.index}]` ||
      (mentions(output.stepId) && /步骤|step/i.test(ref)));
    if (named.length === 1 && mentionedSteps.length === 1) return { ...named[0]! };
    if (mentionedSteps.length || /[A-Za-z_][\w.-]*\s*(?:步骤|step\b)/i.test(ref)) return ref;
    const placeholder = /创建|生成|create/i.test(ref) && /(?:节点|node).{0,30}(?:ID|标识)|(?:ID|标识).{0,30}(?:节点|node)/i.test(ref);
    return !named.length && placeholder && created.length === 1 ? { ...created[0]! } : ref;
  };
  for (const step of plan.steps) {
    if (step.tool === 'create_nodes') {
      for (const node of step.arguments.nodes) node.referenceNodeIds = node.referenceNodeIds.map(bind);
      for (let index = 0; index < step.arguments.nodes.length; index++) created.push({ stepId: step.id, index });
    } else if (step.tool === 'connect_nodes') {
      for (const edge of step.arguments.connections) { edge.source = bind(edge.source); edge.target = bind(edge.target); }
    } else step.arguments.nodeId = bind(step.arguments.nodeId);
  }
}

export function validateRequestBounds(plan: AgentPlan, request: string) {
  if (plan.mode !== 'execute') return;
  if (requestIsReadOnly(request)) throw new Error('本轮用户只授权问答或查看，禁止写操作；请返回mode=answer或clarify，steps必须为空，只回答当前问题，不要执行历史任务');
  const source = request.split('\n\n用户引用的当前画布节点：')[0]!;
  if (plan.steps.some(s => s.tool === 'generate_image') && !imageGenerationRequested(source)) throw new Error('用户没有授权实际生成图片，请移除生成步骤；创建节点或编写提示词不代表授权生成媒体');
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

export function imageGenerationRequested(request: string) {
  const source = request.split('\n\n用户引用的当前画布节点：')[0]!;
  if (requestIsReadOnly(source) || /(?:不要|不用|无需|禁止|不需要|别)\s*(?:实际|真正|直接|自动)?(?:生成|绘制|生图|出图)(?:任何|新的?|这些|那些|这张|那张|[一二三四五六七八九十两\d]+张)?(?:图片|图像|媒体|素材|[，。；\s]|$)/.test(source)) return false;
  const intent = source.replace(/(?:生成|编写|填写|优化|修改|出图|生图)\s*(?:图片|图像|分镜)?的?(?:提示词|prompt)/gi, '');
  return /生成.{0,20}(?:图片|图像|分镜|张)|(?:图片|图像|分镜).{0,20}(?:生成|出图|重试)|重试.{0,20}(?:图片|图像|分镜)|生图|出图|绘制|画(?:一|两|三|几|张|个)/.test(intent);
}

/** Phase two supports asynchronous terminal generation steps. Never pretend a
 * dependent edit can run before its media dependency has finished. */
export function validateGenerationPlan(plan: AgentPlan, graph: { nodes: Array<{ id: string; data: Record<string, unknown> }> }) {
  const nodes = new Map(graph.nodes.map(n => [n.id, n.data]));
  let generating = false;
  const targets = new Set<string>();
  const key = (ref: z.infer<typeof nodeRef>) => typeof ref === 'string' ? ref : `${ref.stepId}:${ref.index}`;
  for (const step of plan.steps) {
    if (step.tool === 'generate_image') {
      generating = true;
      const id = key(step.arguments.nodeId);
      const node = nodes.get(id);
      if (!node || node.kind !== 'image' || node.uploaded || node.status === 'generating') throw new Error('生成目标必须是可生成的图片节点');
      if (targets.has(id)) throw new Error('同一计划不能重复生成同一图片节点');
      if (!String(node.prompt ?? '').trim()) throw new Error('生成前必须填写图片提示词');
      for (const ref of (node.referenceNodeIds ?? []) as z.infer<typeof nodeRef>[]) {
        const source = nodes.get(key(ref));
        if (source?.kind === 'image' && (source.status !== 'ready' || !source.assetId)) throw new Error('当前阶段不能依赖尚未生成完成的图片，请先生成来源图片');
      }
      targets.add(id);
    } else {
      if (generating) throw new Error('图片生成步骤必须放在所有画布编辑步骤之后，当前不支持生成完成后的后续操作');
      if (step.tool === 'create_nodes') step.arguments.nodes.forEach((n, i) => nodes.set(`${step.id}:${i}`, n));
      if (step.tool === 'update_node_prompt') {
        const id = key(step.arguments.nodeId);
        const node = nodes.get(id);
        if (node) nodes.set(id, { ...node, prompt: step.arguments.prompt });
      }
    }
  }
}

export function bindRequestReferences(plan: AgentPlan, request: string, explicitNodeIds: Set<string>, selectedNodeIds = new Set<string>()) {
  const source = request.split('\n\n用户引用的当前画布节点：')[0]!;
  const forbidsReferences = /(?:不(?:要|用|需要|必)?|无需)\s*(?:再|额外)?(?:添加|建立|保留)?(?:引用|依赖|连线|连接)/.test(source);
  const basedOnSource = /引用|参考|基于|根据|依据|依照|改写|扩写|续写|拆分|拆成|转成|转换为/.test(source) ||
    /以.{0,80}为(?:基础|参考|依据)|用.{0,80}(?:创建|生成|制作)/.test(source);
  const hasAttachment = explicitNodeIds.size > 0 && /@\[|节点ID：|用户引用的当前画布节点：/.test(request);
  const sources = !forbidsReferences && (basedOnSource || hasAttachment) ? [...(explicitNodeIds.size ? explicitNodeIds : selectedNodeIds)] : [];
  const created = new Map<string, number>();
  for (const step of plan.steps) {
    if (step.tool !== 'create_nodes') continue;
    for (const node of step.arguments.nodes) {
      const promptRefs = [...node.prompt.matchAll(/@\[[^\]]*\]\(node:([^)]*)\)/g)].map(match => decodeURIComponent(match[1]!));
      if (forbidsReferences && (node.referenceNodeIds.length || promptRefs.length)) throw new Error('用户明确要求不建立依赖，请移除创建步骤中的引用');
      const refs = sources.length ? node.referenceNodeIds.filter(ref => typeof ref === 'string' || ref.index < (created.get(ref.stepId) ?? 0)) : node.referenceNodeIds;
      node.referenceNodeIds = [...new Map([...refs, ...promptRefs, ...sources].map(ref => [typeof ref === 'string' ? ref : JSON.stringify(ref), ref])).values()];
      if (node.referenceNodeIds.length > 8) throw new Error('每个新节点最多引用8个来源，请减少依赖');
    }
    created.set(step.id, step.arguments.nodes.length);
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

export function planningProtocol(definitions: Array<{ name: string; description?: string; inputSchema: unknown }>, readOnly = false) {
  const reference = { description: '已有节点填写上下文中的真实ID；本轮新建节点必须用对象{"stepId":"前面创建步骤的id","index":0}。严禁用描述性字符串或猜测ID。', anyOf: [{ type: 'string', minLength: 1, maxLength: 100 }, { type: 'object', additionalProperties: false, required: ['stepId', 'index'], properties: { stepId: { type: 'string' }, index: { type: 'integer', minimum: 0, maximum: 19 } } }] };
  const tools = definitions.filter(t => !t.name.startsWith('get_')).map(t => {
    const schema = JSON.parse(JSON.stringify(t.inputSchema));
    delete schema.properties.expectedRevision;
    schema.required = (schema.required ?? []).filter((name: string) => name !== 'expectedRevision');
    if (schema.properties.nodeId) schema.properties.nodeId = reference;
    if (t.name === 'create_nodes') schema.properties.nodes.items.properties.referenceNodeIds.items = reference;
    if (t.name === 'create_nodes') delete schema.properties.nodes.items.properties.position;
    if (t.name === 'connect_nodes') {
      schema.properties.connections.items.properties.source = reference;
      schema.properties.connections.items.properties.target = reference;
    }
    return { name: t.name, description: t.description, schema };
  });
  const format = JSON.parse(JSON.stringify(PLAN_FORMAT)) as Record<string, unknown>;
  const properties = format.properties as Record<string, Record<string, unknown>>;
  if (readOnly) {
    properties.mode!.enum = ['answer', 'clarify'];
    properties.steps!.maxItems = 0;
  }
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
    case 'rename_node': case 'update_node_prompt': case 'generate_image': return { ...step.arguments, nodeId: resolve(step.arguments.nodeId) };
    case 'create_nodes': return { nodes: step.arguments.nodes.map(n => ({ ...n, referenceNodeIds: n.referenceNodeIds.map(resolve) })) };
    case 'connect_nodes': return { connections: step.arguments.connections.map(c => ({ source: resolve(c.source), target: resolve(c.target) })) };
  }
}

export function validateReferences(plan: AgentPlan, nodeIds: Set<string>) {
  const created = new Map<string, number>();
  const check = (ref: z.infer<typeof nodeRef>) => {
    if (typeof ref === 'string') {
      if (!nodeIds.has(ref)) throw new Error(`计划引用了不存在或未读取的节点：${ref}。本轮创建的节点尚无真实ID，请改用步骤引用对象，例如${JSON.stringify([...created].flatMap(([stepId, count]) => Array.from({ length: count }, (_, index) => ({ stepId, index }))).slice(0, 20))}，不能填写说明文字或猜测ID`);
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
