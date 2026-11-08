const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const apiRequire = createRequire(path.resolve(__dirname, '../package.json'));
const ts = apiRequire('typescript');
apiRequire('reflect-metadata');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true }, fileName: filename,
}).outputText, filename);
const { CanvasToolsService } = require('../src/modules/canvas-agent/canvas-tools.service.ts');
const { CanvasMcpService } = require('../src/modules/canvas-agent/canvas-mcp.service.ts');
const { CanvasAgentService } = require('../src/modules/canvas-agent/canvas-agent.service.ts');
const { PlanSchema, parsePlanJson, parsePlanCandidate, requestIsReadOnly, bindCreatedNodeReferences, bindRequestLiterals, bindRequestReferences, resolveArguments, validateReferences, validateRequestBounds, validateGenerationPlan, imageGenerationRequested } = require('../src/modules/canvas-agent/agent-plan.ts');
const { buildPlanningContext, CONTEXT_LIMIT, estimateMessages } = require('../src/modules/canvas-agent/agent-context.ts');
const { verifyPlan } = require('../src/modules/canvas-agent/agent-verifier.ts');
const { CanvasChatService } = require('../src/modules/canvas-chat/canvas-chat.service.ts');
const { CreditsService } = require('../src/modules/credits/credits.service.ts');
const { LlmError } = apiRequire('@reel/llm');
const { classifyError } = require('../src/modules/canvas-agent/agent-store.ts');
const plan = steps => ({ mode: 'execute', goal: '执行当前请求', answer: '', steps });
const rename = (title = '测试agent', id = 'rename') => ({ id, description: `名称改为${title}`, tool: 'rename_node', arguments: { nodeId: 'story', title } });
const create = (id = 'create') => ({ id, description: '创建一个视频并引用故事', tool: 'create_nodes', arguments: { nodes: [{ kind: 'video', title: '视频', prompt: '', referenceNodeIds: ['story'] }] } });
const request = content => [{ role: 'user', content }];
const submit = value => ({ type: 'text', text: JSON.stringify(value) });
const collect = async stream => { const events = []; for await (const e of stream) events.push(e); return events; };
const signal = () => AbortSignal.timeout(90000);

test('paid image generation requires explicit authorization and terminal, unique image targets', () => {
  const make = { id: 'create', description: '创建图片', tool: 'create_nodes', arguments: { nodes: [{ kind: 'image', title: '镜头', prompt: '小狗出门', referenceNodeIds: [] }] } };
  const generate = { id: 'generate', description: '生成图片', tool: 'generate_image', arguments: { nodeId: { stepId: 'create', index: 0 } } };
  const value = PlanSchema.parse(plan([make, generate]));
  validateReferences(value, new Set());
  validateGenerationPlan(value, { nodes: [] });
  assert.equal(resolveArguments(value.steps[1], new Map([['create', { createdNodes: [{ id: 'actual' }] }]])).nodeId, 'actual');
  for (const request of ['创建三个图片节点并填写提示词', '生成图片提示词', '为图片生成提示词', '生成图片提示词，不要生成图片', '不要生成任何图片', '先创建节点，别真正出图', '只分析生成图片为什么失败', '生成图片好了吗？']) {
    assert.equal(imageGenerationRequested(request), false, request);
    assert.throws(() => validateRequestBounds(value, request));
  }
  for (const request of ['根据故事生成三张分镜图片', '请帮我生成一张猫', '重试生成这张图片', '重试失败的图片节点', '绘制一张风景图']) {
    assert.equal(imageGenerationRequested(request), true, request);
    validateRequestBounds(value, request);
  }
  assert.throws(() => validateGenerationPlan(PlanSchema.parse(plan([make, generate, { ...generate, id: 'again' }])), { nodes: [] }), /重复/);
  assert.throws(() => validateGenerationPlan(PlanSchema.parse(plan([make, generate, rename()])), { nodes: [] }), /之后/);
  assert.throws(() => validateGenerationPlan(PlanSchema.parse(plan([{ ...generate, arguments: { nodeId: 'video' } }])), { nodes: [{ id: 'video', data: { kind: 'video', prompt: '视频' } }] }), /图片节点/);
});

test('new node placeholders bind only to unambiguous prior creation results', () => {
  for (const placeholder of ['由create_text_node步骤生成的文本节点ID', '从当前步骤第一个操作创建的节点获取的真实ID', 'create_text_node', 'create_text_node[0]']) {
    const value = PlanSchema.parse(plan([create('create_text_node'), { ...rename(), arguments: { nodeId: placeholder, title: '最终说明' } }]));
    bindCreatedNodeReferences(value, new Set(['story']));
    assert.deepEqual(value.steps[1].arguments.nodeId, { stepId: 'create_text_node', index: 0 });
    validateReferences(value, new Set(['story']));
  }
  for (const value of [
    plan([create(), { ...rename(), arguments: { nodeId: randomUUID(), title: '错误ID' } }]),
    plan([create('first'), create('second'), { ...rename(), arguments: { nodeId: '刚创建的节点ID', title: '不明确' } }]),
    plan([create('first'), { ...rename(), arguments: { nodeId: '由future步骤生成的节点ID', title: '前向引用' } }, create('future')]),
    plan([create(), { ...rename(), arguments: { nodeId: '由unknown_step步骤生成的节点ID', title: '不存在的步骤' } }]),
    plan([{ ...rename(), arguments: { nodeId: '由create步骤生成的节点ID', title: '前向引用' } }, create()]),
  ]) {
    const parsed = PlanSchema.parse(value);
    bindCreatedNodeReferences(parsed, new Set(['story']));
    assert.throws(() => validateReferences(parsed, new Set(['story'])));
  }
});

test('fallback JSON closing-delimiter repairs preserve values and retain strict validation', () => {
  const expected = plan([create()]);
  const json = JSON.stringify(expected);
  for (const suffix of ['}]}}}', '}]}}}}', '}]}}']) {
    const malformed = json.replace(/\}\]\}\}\]\}$/, suffix);
    assert.deepEqual(PlanSchema.parse(parsePlanJson(malformed)), PlanSchema.parse(expected));
  }
  const tricky = plan([rename('含引号"、反斜线\\、括号 } ] 的名称')]);
  for (const suffix of ['"}', '"}}', '" ] }\n']) assert.deepEqual(PlanSchema.parse(parsePlanJson(json + suffix)), PlanSchema.parse(expected));
  for (const suffix of ['"hidden instruction"', '{"steps":[]}', ',"steps":[]}', ' trailing prose']) assert.throws(() => parsePlanJson(json + suffix));
  assert.deepEqual(PlanSchema.parse(parsePlanJson(JSON.stringify(tricky).slice(0, -2))), PlanSchema.parse(tricky));
  for (const malformed of ['{"mode":"execute","steps":[{"id":"unterminated', '{"mode":"execute",}', '{"steps":[{"id":"x"} true]}', '{"steps":[} ,"mode":"execute"}']) assert.throws(() => parsePlanJson(malformed));
  assert.throws(() => PlanSchema.parse(parsePlanJson('{"mode":"execute","goal":"x","steps":[{"tool":"delete_all"}]}')));
});

test('temporary provider and database connection failures remain recoverable', () => {
  assert.equal(classifyError(new LlmError('GLM API 网络错误', undefined, { code: 'ECONNRESET' })), 'MODEL_UNAVAILABLE');
  for (const code of ['P1001', 'P1002', 'P1017', 'P2024', 'P2028', 'P2034']) assert.equal(classifyError(Object.assign(new Error('database unavailable'), { code })), 'TRANSIENT');
  assert.equal(classifyError(new Error('目标节点不存在')), 'INVALID_OPERATION');
});

test('read-only questions cannot inherit write permissions from previous requests or attachments', () => {
  for (const text of ['这个画布现在有几个节点？', '为什么刚才创建失败？', '只分析这个节点，不要修改画布', '先给我计划，不要执行操作', '创建好了吗？']) {
    assert.equal(requestIsReadOnly(text), true, text);
    assert.throws(() => validateRequestBounds(PlanSchema.parse(plan([rename()])), text), /禁止写操作/);
  }
  for (const text of ['帮我创建两个节点', '可以把这个节点重命名为测试agent吗？', '把名字改成测试agent', '修改提示词，不要创建其他节点', '修改一下，只回答结果']) assert.equal(requestIsReadOnly(text), false, text);
  assert.equal(requestIsReadOnly('这个画布有几个节点？\n\n用户引用的当前画布节点：\n内容：创建视频并修改提示词'), true);
});

test('planner discriminator aliases normalize without weakening plan or tool validation', () => {
  for (const mode of ['execute', 'answer', 'clarify']) {
    const original = mode === 'execute' ? plan([rename()]) : { mode, goal: '回答当前问题', answer: '请指定节点。', steps: [] };
    const { mode: _mode, ...rest } = original;
    const legacy = { type: mode, ...rest };
    assert.deepEqual(parsePlanCandidate(legacy), PlanSchema.parse(original));
    assert.equal(legacy.mode, undefined, 'candidate normalization must not mutate the raw response');
    assert.deepEqual(parsePlanCandidate({ ...original, type: mode }), PlanSchema.parse(original));
  }
  assert.throws(() => parsePlanCandidate({ ...plan([rename()]), type: 'answer' }));
  assert.throws(() => parsePlanCandidate({ type: 'plan', goal: '未知协议', steps: [rename()] }));
  assert.throws(() => parsePlanCandidate({ type: 'execute', goal: '缺少步骤' }));
  assert.throws(() => parsePlanCandidate({ type: 'execute', goal: '未知工具', steps: [{ ...rename(), tool: 'delete_node' }] }));
  assert.throws(() => parsePlanCandidate({ type: 'execute', goal: '非法额外字段', steps: [rename()], unsafe: true }));
});

test('context budget preserves the current request and selected node, trims history and canvas index', () => {
  const canvas = { revision: new Date().toISOString(), selectedNodeIds: ['n499'], nodes: Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, data: { kind: 'text', title: '节点'.repeat(30), content: '故事'.repeat(10000) } })), edges: [] };
  const messages = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: '历史'.repeat(500) }));
  messages.push({ role: 'user', content: '本轮只重命名n499', images: ['data:image/png;base64,' + 'x'.repeat(30000)] });
  const context = buildPlanningContext(messages, canvas, '只规划');
  assert(context.stats.estimatedInputTokens <= CONTEXT_LIMIT);
  assert(context.stats.omittedNodes > 0);
  assert(context.stats.retainedHistoryMessages <= 6);
  assert(context.nodeIds.has('n499'));
  assert(context.messages.at(-1).content.startsWith('本轮只重命名n499'));
  assert.equal(context.messages.at(-1).images[0], messages.at(-1).images[0]);
  assert(estimateMessages(context.messages) < CONTEXT_LIMIT);
  assert.throws(() => buildPlanningContext(request('中文'.repeat(30000)), canvas, '只规划'), /CONTEXT_BUDGET/);
});

test('plans reject unknown tools, unknown nodes, duplicate steps and forward references', () => {
  assert.throws(() => PlanSchema.parse(plan([{ ...rename(), tool: 'submit_generation' }])));
  assert.throws(() => PlanSchema.parse(plan([rename(), rename()])));
  assert.throws(() => validateReferences(PlanSchema.parse(plan([rename()])), new Set()), /不存在/);
  const future = { ...rename(), arguments: { nodeId: { stepId: 'future', index: 0 }, title: '新名称' } };
  assert.throws(() => validateReferences(PlanSchema.parse(plan([future, create('future')])), new Set(['story'])), /前面创建/);
  const valid = PlanSchema.parse(plan([create(), { ...rename(), arguments: { nodeId: { stepId: 'create', index: 0 }, title: '新名称' } }]));
  validateReferences(valid, new Set(['story']));
  assert.equal(resolveArguments(valid.steps[1], new Map([['create', { createdNodes: [{ id: 'real-id' }] }]])).nodeId, 'real-id');
});

test('verification checks actual state and respects later planned updates of the same field', () => {
  const p = PlanSchema.parse(plan([rename('第一次', 'a'), rename('第二次', 'b')]));
  const results = new Map([['a', { renamedNodeId: 'story' }], ['b', { renamedNodeId: 'story' }]]);
  verifyPlan(p, results, { nodes: [{ id: 'story', data: { title: '第二次' } }], edges: [] });
  assert.throws(() => verifyPlan(p, results, { nodes: [{ id: 'story', data: { title: '第一次' } }], edges: [] }), /实际结果/);
});

test('explicit rename literals and node references take precedence over model paraphrasing and stale selection', () => {
  const p = PlanSchema.parse(plan([rename('测试 agent')]));
  bindRequestLiterals(p, '把该节点的名称改为测试agent，节点是目标视频', new Set(['video']));
  assert.equal(p.steps[0].arguments.title, '测试agent');
  assert.equal(p.steps[0].arguments.nodeId, 'video');
  const spaced = PlanSchema.parse(plan([rename('Testagent')]));
  bindRequestLiterals(spaced, '重命名为「Test agent」');
  assert.equal(spaced.steps[0].arguments.title, 'Test agent');
});

test('explicit creation quantities reject unnecessary copied source nodes before execution', () => {
  const p = PlanSchema.parse(plan([create()]));
  validateRequestBounds(p, '引用图片，创建一个新的视频节点');
  p.steps[0].arguments.nodes.push({ kind: 'image', title: '多余副本', prompt: '', referenceNodeIds: [] });
  assert.throws(() => validateRequestBounds(p, '引用图片，创建一个新的视频节点'), /不能额外创建/);
});

test('an explicit single source is bound to its real ID instead of a model-invented self reference', () => {
  const p = PlanSchema.parse(plan([create()]));
  p.steps[0].arguments.nodes[0].referenceNodeIds = [{ stepId: '当前步骤', index: 0 }];
  bindRequestReferences(p, '引用story，创建一个新的视频节点', new Set(['story']));
  validateReferences(p, new Set(['story']));
  assert.deepEqual(p.steps[0].arguments.nodes[0].referenceNodeIds, ['story']);
});

test('based-on requests bind every new node to explicit sources or selected nodes', () => {
  for (const wording of ['基于这个节点创建四个图片节点', '根据选中的故事拆分为四个分镜', '参考该节点新增四个图片节点']) {
    const p = PlanSchema.parse(plan([{ id: 'shots', description: '创建分镜', tool: 'create_nodes', arguments: { nodes: Array.from({ length: 4 }, (_, index) => ({ kind: 'image', title: `镜头${index}` })) } }]));
    bindRequestReferences(p, wording, new Set(), new Set(['story']));
    assert(p.steps[0].arguments.nodes.every(node => JSON.stringify(node.referenceNodeIds) === '["story"]'));
    validateReferences(p, new Set(['story']));
  }
  const attached = PlanSchema.parse(plan([create()]));
  attached.steps[0].arguments.nodes[0].referenceNodeIds = [];
  bindRequestReferences(attached, '创建视频 【图片】(节点ID：photo)', new Set(['photo']), new Set(['stale-selection']));
  assert.deepEqual(attached.steps[0].arguments.nodes[0].referenceNodeIds, ['photo']);
  const independent = PlanSchema.parse(plan([create()]));
  independent.steps[0].arguments.nodes[0].referenceNodeIds = [];
  bindRequestReferences(independent, '创建一个独立的视频节点', new Set(), new Set(['story']));
  assert.deepEqual(independent.steps[0].arguments.nodes[0].referenceNodeIds, []);
  bindRequestReferences(independent, '基于这个节点创建视频，但不要建立连线', new Set(['story']));
  assert.deepEqual(independent.steps[0].arguments.nodes[0].referenceNodeIds, []);
});

test('dependency neighbourhoods and IDs inside referenced node content do not become explicit sources', () => {
  const canvas = { revision: new Date().toISOString(), selectedNodeIds: ['old'], nodes: ['source', 'parent', 'old'].map(id => ({ id, data: { kind: 'text', title: id, content: '' } })), edges: [{ source: 'parent', target: 'source' }] };
  const context = buildPlanningContext(request('基于该节点创建图片\n\n用户引用的当前画布节点：\n引用 ID：source\n内容：parent是之前引用的节点'), canvas, '只规划');
  assert.deepEqual([...context.explicitNodeIds], ['source']);
  assert(context.nodeIds.has('parent'));
});

test('planning context reports the actual image count and never claims to see missing images', () => {
  const canvas = { revision: new Date().toISOString(), selectedNodeIds: ['photo'], nodes: [{ id: 'photo', data: { kind: 'image', title: '图片' } }], edges: [] };
  const absent = buildPlanningContext(request('描述选中图片'), canvas, '只规划');
  assert(absent.messages[0].content.includes('本轮未附带图片'));
  const attached = buildPlanningContext([{ role: 'user', content: '描述图片', images: ['data:image/png;base64,test'] }], canvas, '只规划');
  assert(attached.messages[0].content.includes('本轮附带 1 张图片'));
});

const dbEnabled = process.env.AGENT_DATABASE_TESTS === '1' || process.env.LIVE_AGENT_SMOKE === '1';
let db, admin, schema, user;
before(async () => {
  if (!dbEnabled) return;
  const { PrismaClient } = apiRequire('@reel/db');
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert(databaseUrl, 'DATABASE_URL is required');
  const url = new URL(databaseUrl);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only local test databases are allowed');
  admin = new PrismaClient({ datasourceUrl: databaseUrl });
  schema = `agent_plan_test_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.set('schema', schema);
  const { execFileSync } = require('node:child_process');
  const root = path.resolve(__dirname, '../../..');
  const prismaPackage = createRequire(path.join(root, 'packages/db/package.json')).resolve('prisma/package.json');
  execFileSync(process.execPath, [path.join(path.dirname(prismaPackage), 'build/index.js'), 'migrate', 'deploy'], { cwd: path.join(root, 'packages/db'), env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
  db = new PrismaClient({ datasourceUrl: url.toString() });
  user = await db.user.create({ data: { email: `${schema}@invalid.test`, name: 'Plan execution test' } });
});
after(async () => {
  await db?.$disconnect();
  if (admin) {
    try { assert.match(schema, /^agent_plan_test_[a-f0-9]{32}$/); await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await admin.$disconnect(); }
  }
});
async function fixture(value = plan([rename()]), customDb = db, images, initialGraph) {
  const graph = initialGraph ?? { version: 1, nodes: [{ id: 'story', type: 'workflow', position: { x: 0, y: 0 }, data: { kind: 'text', title: '故事', prompt: '', content: '小狗出门、迷路、遇到朋友、一起回家', status: 'ready' } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  const canvas = await db.canvas.create({ data: { userId: user.id, name: 'Plan fixture', graph } });
  const conversation = await db.canvasConversation.create({ data: { userId: user.id, canvasId: canvas.id } });
  const scope = { userId: user.id, canvasId: canvas.id, selectedNodeIds: ['story'] };
  let calls = 0;
  const model = { chatStreamEvents: async function* (messages, options) {
    calls++;
    assert.equal(options.tools, undefined, 'Planner must not have execution tools');
    assert.deepEqual((await db.canvas.findUnique({ where: { id: canvas.id } })).graph, graph, 'Planning must not mutate the canvas');
    yield submit(typeof value === 'function' ? await value(messages, options, calls) : value);
  } };
  const mcp = new CanvasMcpService(new CanvasToolsService(customDb, images));
  const agent = new CanvasAgentService(mcp, model, db);
  return { agent, mcp, scope, canvas, conversation, model, calls: () => calls, graph: async () => (await db.canvas.findUnique({ where: { id: canvas.id } })).graph,
    run: (messages = request('执行计划中指定的画布操作'), id = randomUUID(), resume = false, abort = signal()) => agent.run(scope, conversation.id, messages, 'glm-4.6v-flash', abort, id, resume) };
}

test('database Plan & Execute guarantees', { skip: !dbEnabled, timeout: 120000 }, async t => {
  await t.test('creation split across steps stays in the same vertical column', async () => {
    const f = await fixture(plan([create('first'), create('second')]));
    await collect(f.run());
    const graph = await f.graph();
    assert.equal(graph.nodes.length, 3);
    assert.equal(graph.nodes[1].position.x, graph.nodes[2].position.x);
    assert(graph.nodes[2].position.y >= graph.nodes[1].position.y + 560);
    assert.equal(graph.edges.length, 2);
  });
  await t.test('create with content then rename resolves descriptive output IDs and preserves existing nodes', async () => {
    const value = plan([
      { id: 'create_text_node', description: '创建并填写内容', tool: 'create_nodes', arguments: { nodes: [{ kind: 'text', title: '临时说明', content: '测试内容' }] } },
      { ...rename('最终说明'), arguments: { nodeId: '由create_text_node步骤生成的文本节点ID', title: '最终说明' } },
    ]);
    const f = await fixture(value);
    const events = await collect(f.run(request('创建一个名为临时说明的文本节点，内容为测试内容，然后把它重命名为最终说明')));
    const graph = await f.graph();
    assert.equal(f.calls(), 1);
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.nodes[0].data.title, '故事');
    assert.equal(graph.nodes[1].data.title, '最终说明');
    assert.equal(graph.nodes[1].data.content, '测试内容');
    assert.equal(graph.nodes[1].data.status, 'ready');
    assert.equal(events.filter(event => event.event === 'canvas').length, 2);
    const run = await db.canvasAgentRun.findFirst({ where: { conversationId: f.conversation.id } });
    assert.equal(run.status, 'completed');
    assert.deepEqual(run.plan.steps[1].arguments.nodeId, { stepId: 'create_text_node', index: 0 });
  });
  await t.test('a stale write plan for a read-only question is rejected before any tool execution', async () => {
    const f = await fixture((_messages, _options, attempts) => attempts === 1 ? plan([rename()]) : { mode: 'answer', goal: '回答当前节点数量', answer: '当前有1个节点。', steps: [] });
    await collect(f.run(request('这个画布有几个节点？只回答数量，不要修改画布。')));
    assert.equal(f.calls(), 2);
    assert.equal((await f.graph()).nodes[0].data.title, '故事');
    assert.equal(await db.canvasAgentStep.count({ where: { run: { conversationId: f.conversation.id } } }), 0);
    const run = await db.canvasAgentRun.findFirst({ where: { conversationId: f.conversation.id } });
    assert.equal(run.plan.mode, 'answer');
    assert(run.events.some(event => event.phase === 'planning' && event.status === 'rejected'));
  });
  await t.test('unavailable context reads retry within a bound and do not execute a partial plan', async () => {
    const f = await fixture();
    const connect = f.mcp.connect.bind(f.mcp);
    let reads = 0;
    f.mcp.connect = async scope => {
      const session = await connect(scope);
      const call = session.client.callTool.bind(session.client);
      session.client.callTool = async (...args) => {
        if (args[0].name === 'get_canvas_context' && reads++ < 2) return { isError: true, structuredContent: { code: 'TRANSIENT' }, content: [{ type: 'text', text: 'temporarily unavailable' }] };
        return call(...args);
      };
      return session;
    };
    await collect(f.run());
    assert.equal(f.calls(), 1);
    assert.equal((await f.graph()).nodes[0].data.title, '测试agent');
    assert.equal((await db.canvasAgentStep.findFirst({ where: { run: { conversationId: f.conversation.id } } })).attempts, 1);
  });
  await t.test('user messages precede assistant replies even when PostgreSQL transaction timestamps are identical', async () => {
    const f = await fixture();
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    await db.canvasChatMessage.createMany({ data: [
      { id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', conversationId: f.conversation.id, role: 'user', content: '问题', createdAt },
      { id: '00000000-0000-0000-0000-000000000000', conversationId: f.conversation.id, role: 'assistant', content: '回答', createdAt },
    ] });
    const chat = new CanvasChatService(db, {}, {}, {}, f.agent);
    const history = await chat.get(user.id, f.canvas.id, f.conversation.id);
    assert.deepEqual(history.messages.map(message => message.role), ['user', 'assistant']);
  });
  await t.test('create then update prompt retains the reference throughout verification', async () => {
    const f = await fixture(plan([create(), { id: 'prompt', description: '修改新视频提示词', tool: 'update_node_prompt', arguments: { nodeId: { stepId: 'create', index: 0 }, prompt: '夜景' } }]));
    await collect(f.run());
    const graph = await f.graph();
    assert.equal(graph.edges.length, 1);
    assert.deepEqual(graph.nodes[1].data.referenceNodeIds, ['story']);
    assert(graph.nodes[1].data.prompt.includes('(node:story)'));
    assert.equal((await db.canvasAgentRun.findFirst({ where: { conversationId: f.conversation.id } })).status, 'completed');
  });
  await t.test('creating several nodes based on a selected story commits and verifies every dependency', async () => {
    const f = await fixture(plan([{ id: 'shots', description: '根据故事创建分镜', tool: 'create_nodes', arguments: { nodes: Array.from({ length: 4 }, (_, index) => ({ kind: 'image', title: `镜头${index}`, referenceNodeIds: [] })) } }]));
    await collect(f.run(request('根据选中的故事创建四个图片节点')));
    const graph = await f.graph();
    assert.equal(graph.nodes.length, 5);
    assert.equal(graph.edges.length, 4);
    for (const node of graph.nodes.slice(1)) {
      assert.deepEqual(node.data.referenceNodeIds, ['story']);
      assert(graph.edges.some(edge => edge.source === 'story' && edge.target === node.id));
      assert(node.data.prompt.includes('(node:story)'));
      assert(node.position.x >= 360 + 160);
    }
    const run = await db.canvasAgentRun.findFirst({ where: { conversationId: f.conversation.id } });
    assert.equal(run.status, 'completed');
    assert(run.plan.steps[0].arguments.nodes.every(node => node.referenceNodeIds.includes('story')));
  });
  await t.test('a type=execute rename plan is normalized, persisted and executed exactly once', async () => {
    const { mode: _mode, ...rest } = plan([rename()]);
    const f = await fixture({ ...rest, type: 'execute' });
    const events = await collect(f.run(request('将story的名称改为测试agent')));
    assert.equal(f.calls(), 1);
    assert.equal((await f.graph()).nodes[0].data.title, '测试agent');
    assert.equal((await f.graph()).nodes.length, 1);
    const run = await db.canvasAgentRun.findFirst({ where: { conversationId: f.conversation.id }, include: { steps: true } });
    assert.equal(run.status, 'completed');
    assert.equal(run.plan.mode, 'execute');
    assert(!Object.hasOwn(run.plan, 'type'));
    assert.equal(run.steps.length, 1);
    assert.equal(run.steps[0].attempts, 1);
    assert.equal(events.filter(e => e.event === 'canvas').length, 1);
  });
  await t.test('plan persists before any write; rename completes with a single planning call', async () => {
    const f = await fixture();
    const stream = f.run();
    let sawPlan = false;
    const events = [];
    for await (const e of stream) {
      events.push(e);
      if (e.event === 'plan') {
        sawPlan = true;
        const run = await db.canvasAgentRun.findUnique({ where: { id: e.data.runId }, include: { steps: true } });
        assert.equal(run.plan.steps.length, 1);
        assert.equal(run.steps[0].status, 'pending');
        assert.equal((await f.graph()).nodes[0].data.title, '故事');
      }
      if (e.event === 'tool' && e.data.name === 'rename_node') assert(sawPlan);
    }
    assert.equal(f.calls(), 1);
    assert.equal((await f.graph()).nodes[0].data.title, '测试agent');
    assert(events.at(-1).data.text.includes('测试agent'));
    const run = await db.canvasAgentRun.findFirst({ where: { conversationId: f.conversation.id }, include: { steps: true } });
    assert.equal(run.status, 'completed');
    assert.equal(run.steps[0].status, 'completed');
    assert(run.steps[0].result.renamedNodeId);
    assert.equal(await db.canvasAgentLease.count({ where: { canvasId: f.canvas.id } }), 0);
  });
  await t.test('invalid plans stop after three bounded corrections without modifying the canvas', async () => {
    const f = await fixture(plan([{ ...rename(), arguments: { nodeId: 'missing', title: 'bad' } }]));
    await assert.rejects(() => collect(f.run()), /有效计划/);
    assert.equal(f.calls(), 3);
    assert.equal((await f.graph()).nodes[0].data.title, '故事');
    assert.equal((await db.canvasAgentRun.findFirst({ where: { conversationId: f.conversation.id } })).errorCode, 'INVALID_PLAN');
  });
  await t.test('created-node references resolve deterministically and verification checks the resulting edges', async () => {
    const f = await fixture(plan([create(), { id: 'renameVideo', description: '重命名刚创建的视频', tool: 'rename_node', arguments: { nodeId: { stepId: 'create', index: 0 }, title: '新视频' } }]));
    await collect(f.run());
    const graph = await f.graph();
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.nodes[1].data.title, '新视频');
    assert.equal(graph.edges.length, 1);
    assert.equal(graph.edges[0].target, graph.nodes[1].id);
  });
  await t.test('same request replays its receipt; changed input and foreign ownership are rejected', async () => {
    const f = await fixture(plan([create()]));
    const id = randomUUID(); const messages = request('创建一个视频');
    await collect(f.run(messages, id));
    await collect(f.run(messages, id));
    assert.equal(f.calls(), 1);
    assert.equal((await f.graph()).nodes.length, 2);
    await assert.rejects(() => collect(f.run(request('不同请求'), id)), /不同指令/);
    await assert.rejects(f.agent.claim({ ...f.scope, userId: 'another-user' }, f.conversation.id, randomUUID(), {}), /不存在/);
  });
  await t.test('a lost tool response is recovered from the atomic receipt without repeating creation', async () => {
    const f = await fixture(plan([create()]));
    const connect = f.mcp.connect.bind(f.mcp);
    let lost = false;
    f.mcp.connect = async scope => {
      const session = await connect(scope); const call = session.client.callTool.bind(session.client);
      session.client.callTool = async (...args) => { const response = await call(...args); if (scope.execution && !lost) { lost = true; throw new Error('simulated lost response after commit'); } return response; };
      return session;
    };
    await collect(f.run());
    assert.equal((await f.graph()).nodes.length, 2);
    const run = await db.canvasAgentRun.findFirst({ where: { conversationId: f.conversation.id }, include: { steps: true } });
    assert.equal(run.steps[0].attempts, 1);
    assert(run.events.some(e => e.recoveredReceipt));
  });
  await t.test('interrupted execution resumes a saved plan and skips previously committed steps', async () => {
    const f = await fixture(plan([create(), { ...rename('恢复后改名'), arguments: { nodeId: { stepId: 'create', index: 0 }, title: '恢复后改名' } }]));
    const id = randomUUID(); const messages = request('创建再改名');
    const stream = f.run(messages, id);
    while (true) { const next = await stream.next(); if (next.done || next.value.event === 'canvas') break; }
    await stream.return();
    assert.equal((await f.graph()).nodes.length, 2);
    const first = await db.canvasAgentRun.findFirst({ where: { conversationId: f.conversation.id } });
    assert.equal(first.status, 'interrupted');
    await assert.rejects(() => collect(f.run(messages, id)), /恢复/);
    // A new service instance has no in-memory execution state.
    const restored = new CanvasAgentService(f.mcp, { chatStreamEvents: async function* () { assert.fail('resume must not replan committed work'); } }, db);
    await collect(restored.run(f.scope, f.conversation.id, messages, 'glm-4.6v-flash', signal(), id, true));
    assert.equal((await f.graph()).nodes.length, 2);
    assert.equal((await f.graph()).nodes[1].data.title, '恢复后改名');
  });
  await t.test('lease fencing rejects concurrent tasks and prevents an expired worker from committing', async () => {
    const f = await fixture();
    const input = { same: true }; const id = randomUUID();
    const old = await f.agent.claim(f.scope, f.conversation.id, id, input);
    await assert.rejects(f.agent.claim(f.scope, f.conversation.id, randomUUID(), {}), /执行中/);
    await db.canvasAgentLease.update({ where: { canvasId: f.canvas.id }, data: { expiresAt: new Date(0) } });
    const next = await f.agent.claim(f.scope, f.conversation.id, id, input, true);
    await assert.rejects(f.agent.store.update(old, { status: 'completed' }), /失效/);
    const step = await db.canvasAgentStep.create({ data: { runId: old.run.id, stepKey: 'rename', ordinal: 0, tool: 'rename_node', arguments: rename().arguments } });
    await assert.rejects(new CanvasToolsService(db).execute({ ...f.scope, execution: { runId: old.run.id, stepId: step.id, token: old.token } }, 'rename_node', { expectedRevision: f.canvas.updatedAt.toISOString(), nodeId: 'story', title: 'bad' }), /失效/);
    await f.agent.store.release(old);
    assert.equal((await db.canvasAgentLease.findUnique({ where: { canvasId: f.canvas.id } })).token, next.token);
    await f.agent.store.release(next);
  });
  await t.test('revision conflicts retry after reading fresh context without replanning', async () => {
    const f = await fixture(); const connect = f.mcp.connect.bind(f.mcp); let raced = false;
    f.mcp.connect = async scope => {
      const session = await connect(scope); const call = session.client.callTool.bind(session.client);
      session.client.callTool = async (...args) => {
        if (scope.execution && !raced) { raced = true; await db.canvas.update({ where: { id: f.canvas.id }, data: { updatedAt: new Date(Date.now() + 1000) } }); }
        return call(...args);
      }; return session;
    };
    await collect(f.run());
    assert.equal(f.calls(), 1);
    const run = await db.canvasAgentRun.findFirst({ where: { conversationId: f.conversation.id }, include: { steps: true } });
    assert.equal(run.steps[0].attempts, 2);
  });
  await t.test('changed target preconditions prevent overwriting a concurrent user edit', async () => {
    const f = await fixture(); const stream = f.run();
    while (true) { const next = await stream.next(); if (next.done || next.value.event === 'plan') break; }
    const graph = await f.graph(); graph.nodes[0].data.title = '用户刚改的名字';
    await db.canvas.update({ where: { id: f.canvas.id }, data: { graph } });
    await assert.rejects(() => collect(stream), /其他操作修改/);
    assert.equal((await f.graph()).nodes[0].data.title, '用户刚改的名字');
    assert.equal((await db.canvasAgentRun.findFirst({ where: { conversationId: f.conversation.id } })).errorCode, 'PRECONDITION_CHANGED');
  });
  await t.test('graph mutation rolls back when the receipt cannot commit', async () => {
    const faultyDb = new Proxy(db, { get(target, key) {
      if (key !== '$transaction') return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
      return fn => target.$transaction(tx => fn(new Proxy(tx, { get(t, k) {
        if (k === 'canvasAgentStep') return new Proxy(t[k], { get(step, method) { if (method === 'update') return async () => { throw new Error('receipt failure'); }; return typeof step[method] === 'function' ? step[method].bind(step) : step[method]; } });
        return typeof t[k] === 'function' ? t[k].bind(t) : t[k];
      } })));
    } });
    const f = await fixture(plan([create()]), faultyDb);
    await assert.rejects(() => collect(f.run()), /receipt failure/);
    assert.equal((await f.graph()).nodes.length, 1);
    assert.equal(await db.canvasAgentStep.count({ where: { run: { conversationId: f.conversation.id }, status: 'completed' } }), 0);
  });
  await t.test('database conflicts retain their error class across MCP and retry safely', async () => {
    let conflict = true;
    const transientDb = new Proxy(db, { get(target, key) {
      if (key === '$transaction') return async fn => {
        if (conflict) { conflict = false; throw Object.assign(new Error('write conflict'), { code: 'P2034' }); }
        return target.$transaction(fn);
      };
      return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
    } });
    const f = await fixture(plan([create()]), transientDb);
    await collect(f.run());
    assert.equal((await f.graph()).nodes.length, 2);
    const step = await db.canvasAgentStep.findFirst({ where: { run: { conversationId: f.conversation.id } } });
    assert.equal(step.attempts, 2);
    assert.equal(step.status, 'completed');
  });
  await t.test('verification failure never marks the run completed', async () => {
    const f = await fixture(); const stream = f.run();
    while (true) { const next = await stream.next(); if (next.done || next.value.event === 'canvas') break; }
    const graph = await f.graph(); graph.nodes[0].data.title = '外部改动';
    await db.canvas.update({ where: { id: f.canvas.id }, data: { graph } });
    await assert.rejects(() => collect(stream), /实际结果与计划不符/);
    const run = await db.canvasAgentRun.findFirst({ where: { conversationId: f.conversation.id } });
    assert.equal(run.status, 'partial'); assert.equal(run.errorCode, 'VERIFICATION_FAILED');
  });
  await t.test('chat delivery and billing are idempotent for a repeated request', async () => {
    const f = await fixture(); const config = { get: () => '/tmp' };
    const credits = new CreditsService(db, config);
    const chat = new CanvasChatService(db, f.model, credits, config, f.agent);
    const id = randomUUID();
    await collect(chat.sendStream(user.id, f.canvas.id, f.conversation.id, '把story改名为测试agent', [], signal(), ['story'], id));
    const before = await credits.balance(user.id);
    await collect(chat.sendStream(user.id, f.canvas.id, f.conversation.id, '把story改名为测试agent', [], signal(), ['story'], id));
    assert.equal(f.calls(), 1);
    assert.equal((await credits.balance(user.id)).spent, before.spent);
    assert.equal(await db.canvasChatMessage.count({ where: { conversationId: f.conversation.id } }), 2);
    const run = await db.canvasAgentRun.findFirst({ where: { conversationId: f.conversation.id } });
    assert(run.deliveredAt);
    const resume = await chat.resumeInput(user.id, f.canvas.id, f.conversation.id, run.id);
    assert.equal(resume.requestId, id);
    await assert.rejects(chat.resumeInput('not-owner', f.canvas.id, f.conversation.id, run.id), /not found/);
  });
  await t.test('chat interruption refunds the hold; explicit resume reuses the plan and charges only once', async () => {
    const f = await fixture(plan([create(), { ...rename('最终视频'), arguments: { nodeId: { stepId: 'create', index: 0 }, title: '最终视频' } }]));
    const config = { get: () => '/tmp' };
    const credits = new CreditsService(db, config);
    const chat = new CanvasChatService(db, f.model, credits, config, f.agent);
    const id = randomUUID(); const content = '引用story，创建一个视频节点，再把新节点重命名为最终视频';
    const balance = await credits.balance(user.id);
    const stream = chat.sendStream(user.id, f.canvas.id, f.conversation.id, content, [], signal(), ['story'], id);
    while (true) { const next = await stream.next(); if (next.done || next.value.event === 'canvas') break; }
    await stream.return();
    assert.equal((await credits.balance(user.id)).spent, balance.spent);
    const run = await db.canvasAgentRun.findFirst({ where: { conversationId: f.conversation.id } });
    const input = await chat.resumeInput(user.id, f.canvas.id, f.conversation.id, run.id);
    await collect(chat.sendStream(user.id, f.canvas.id, f.conversation.id, input.content, input.references, signal(), input.selectedNodeIds, input.requestId, true));
    assert.equal((await f.graph()).nodes.length, 2);
    assert.equal((await f.graph()).nodes[1].data.title, '最终视频');
    assert.equal((await credits.balance(user.id)).spent, balance.spent + 1);
    assert.equal(await db.canvasChatMessage.count({ where: { conversationId: f.conversation.id } }), 2);
    assert.equal(f.calls(), 1);
  });
  await t.test('429 fallback changes only the planner model and does not replay writes', async () => {
    const f = await fixture(); let calls = 0;
    f.agent = new CanvasAgentService(f.mcp, { chatStreamEvents: async function* (_messages, options) {
      calls++;
      if (options.model === 'glm-4.6v-flash') throw new LlmError('busy', 429);
      yield submit(plan([rename()]));
    } }, db);
    await collect(f.agent.run(f.scope, f.conversation.id, request('重命名story为测试agent'), 'glm-4.6v-flash', signal()));
    assert.equal(calls, 2);
    assert.equal((await f.graph()).nodes[0].data.title, '测试agent');
  });
  await t.test('transient model failure retries planning within a bound before any mutation', async () => {
    const f = await fixture(); let attempts = 0;
    const agent = new CanvasAgentService(f.mcp, { chatStreamEvents: async function* () {
      attempts++;
      if (attempts === 1) throw new LlmError('unavailable', 503);
      yield submit(plan([rename()]));
    } }, db);
    await collect(agent.run(f.scope, f.conversation.id, request('重命名'), 'glm-4.6v-flash', signal()));
    assert.equal(attempts, 2);
    assert.equal((await f.graph()).nodes[0].data.title, '测试agent');
  });
  await t.test('ordinary questions and clarification finish without writing the canvas', async () => {
    for (const mode of ['answer', 'clarify']) {
      const f = await fixture({ mode, goal: '回答问题', answer: '请指定需要修改的节点。', steps: [] });
      const id = randomUUID(); const messages = request('请回答当前问题');
      await collect(f.run(messages, id));
      await collect(f.run(messages, id));
      assert.equal((await f.graph()).nodes[0].data.title, '故事');
      assert.equal(await db.canvasAgentStep.count({ where: { run: { conversationId: f.conversation.id } } }), 0);
      assert.equal((await db.canvasAgentRun.findFirst({ where: { conversationId: f.conversation.id } })).status, mode === 'clarify' ? 'awaiting_input' : 'completed');
      assert.equal(f.calls(), 1);
    }
  });
});

test('database asynchronous image Plan & Execute closure', { skip: !dbEnabled, timeout: 120000 }, async t => {
  const { GenerationTasksService } = require('../src/modules/generation-tasks/generation-tasks.service.ts');
  const { GenerationTasksProcessor } = require('../src/modules/generation-tasks/generation-tasks.processor.ts');
  const { CanvasImageToolsService } = require('../src/modules/canvas-agent/canvas-image-tools.service.ts');
  const { CanvasGenerationRecovery } = require('../src/modules/canvas-agent/canvas-generation-recovery.service.ts');
  const config = { get: key => ({ GLM_IMAGE_MODEL: 'cogview-3-flash', GLM_API_KEY: 'fake', GLM_BASE_URL: 'https://invalid.test', STORAGE_DIR: '/tmp' })[key] };
  const credits = new CreditsService(db, config);
  await credits.balance(user.id);
  await db.creditAccount.update({ where: { userId: user.id }, data: { available: 1000 } });
  await db.platformSetting.upsert({ where: { key: 'maxConcurrent' }, create: { key: 'maxConcurrent', value: 2 }, update: { value: 2 } });
  const queue = { add: async () => {} };
  const makePlan = count => plan([
    { id: 'shots', description: '创建分镜并引用故事', tool: 'create_nodes', arguments: { nodes: Array.from({ length: count }, (_, i) => ({ kind: 'image', title: `镜头${i + 1}`, prompt: `镜头${i + 1}，小狗冒险`, referenceNodeIds: ['story'] })) } },
    ...Array.from({ length: count }, (_, i) => ({ id: `generate${i}`, description: `生成镜头${i + 1}`, tool: 'generate_image', arguments: { nodeId: { stepId: 'shots', index: i } } })),
  ]);
  const processItem = async (worker, itemId) => {
    const item = await db.generationTaskItem.findUniqueOrThrow({ where: { id: itemId } });
    await db.generationTaskItem.update({ where: { id: itemId }, data: { nextRunAt: new Date(0) } });
    await worker.process({ data: { id: itemId, revision: item.revision } });
  };
  await t.test('three images survive capacity suspension, restart, mixed failure and an independent retry without re-planning or duplicate charges', async () => {
    const tasks = new GenerationTasksService(db, config, queue, credits);
    const images = new CanvasImageToolsService(db, tasks, config);
    const f = await fixture(makePlan(3), db, images);
    const chat = new CanvasChatService(db, f.model, credits, config, f.agent);
    const content = '根据story生成三张分镜图片'; const requestId = randomUUID();
    const before = await credits.balance(user.id);
    const send = () => collect(chat.sendStream(user.id, f.canvas.id, f.conversation.id, content, [], signal(), ['story'], requestId));
    const events = await send();
    assert(events.some(e => e.event === 'plan'));
    const run = await db.canvasAgentRun.findFirstOrThrow({ where: { conversationId: f.conversation.id } });
    assert.equal(run.status, 'waiting_generation');
    assert(run.deliveredAt);
    assert.equal(await db.generationTask.count({ where: { canvasId: f.canvas.id } }), 2, 'only available generation slots may be submitted; other steps must remain durable');
    assert.equal((await db.canvasAgentStep.findMany({ where: { runId: run.id, status: 'pending' } })).length, 1);
    await send();
    assert.equal(f.calls(), 1);
    assert.equal(await db.generationTask.count({ where: { canvasId: f.canvas.id } }), 2);
    const firstTask = await db.generationTask.findFirstOrThrow({ where: { canvasId: f.canvas.id }, include: { items: true } });
    assert((firstTask.input).prompt.includes('小狗出门、迷路、遇到朋友、一起回家'));
    const raw = await f.graph();
    assert.equal(raw.edges.length, 3);
    assert(raw.nodes.slice(1).every((n, i, nodes) => !i || n.position.y > nodes[i - 1].position.y));
    let providerCalls = 0;
    const worker = new GenerationTasksProcessor(db, tasks, config, {});
    worker.provider = { generateImage: async input => {
      providerCalls++;
      if (input.prompt.includes('镜头2')) throw new (apiRequire('@reel/ai-gen').AiGenError)('fixture rejection', 400);
      return { url: 'https://invalid.test/fake.png', model: 'cogview-3-flash' };
    } };
    worker.saveMedia = async id => ({ url: `/files/users/${user.id}/generated/${id}.png`, localPath: `/tmp/${id}.png`, width: 1024, height: 1024 });
    await processItem(worker, firstTask.items[0].id);
    await processItem(worker, firstTask.items[0].id);
    // Fresh coordinator/service instances simulate an API restart. The planner
    // throws if invoked: continuation must use only the persisted plan.
    const restartedAgent = new CanvasAgentService(f.mcp, { chatStreamEvents: async function* () { throw new Error('must not re-plan'); } }, db);
    const recovery = new CanvasGenerationRecovery(db, restartedAgent, f.mcp);
    await recovery.tick();
    assert.equal(await db.generationTask.count({ where: { canvasId: f.canvas.id } }), 3);
    const rest = await db.generationTask.findMany({ where: { canvasId: f.canvas.id, id: { not: firstTask.id } }, include: { items: true } });
    for (const task of rest) { await processItem(worker, task.items[0].id); await processItem(worker, task.items[0].id); }
    await recovery.tick();
    const done = await db.canvasAgentRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(done.status, 'completed_with_errors');
    assert.match(done.response, /2 张成功，1 张失败/);
    assert.equal(providerCalls, 3);
    const balance = await credits.balance(user.id);
    assert.equal(balance.spent - before.spent, 21, 'one chat plus two successful pictures; failed picture is refunded');
    assert.equal(balance.frozen, 0);
    const graph = await f.graph();
    assert.equal(graph.nodes.filter(n => n.data.status === 'ready' && n.data.kind === 'image').length, 2);
    const failedNode = graph.nodes.find(n => n.data.kind === 'image' && n.data.status === 'failed');
    assert(failedNode);
    await send(); await recovery.tick();
    assert.equal(f.calls(), 1); assert.equal(providerCalls, 3);
    assert.equal((await credits.balance(user.id)).spent, balance.spent);
    assert.equal((await chat.get(user.id, f.canvas.id, f.conversation.id)).messages.at(-1).content, done.response);
    // A new explicit user request retries only the failed target, with its own
    // operation identity. Successful siblings are retained.
    const retryPlan = plan([{ id: 'retry', description: '重试失败图片', tool: 'generate_image', arguments: { nodeId: failedNode.id } }]);
    const retryModel = { chatStreamEvents: async function* () { yield submit(retryPlan); } };
    const retryAgent = new CanvasAgentService(f.mcp, retryModel, db);
    const retryChat = new CanvasChatService(db, retryModel, credits, config, retryAgent);
    await collect(retryChat.sendStream(user.id, f.canvas.id, f.conversation.id, '重试生成这张图片', [], signal(), [failedNode.id], randomUUID()));
    const retried = await db.generationTask.findFirstOrThrow({ where: { canvasId: f.canvas.id, nodeId: failedNode.id, id: { not: failedNode.data.generationTaskId } }, include: { items: true } });
    worker.provider.generateImage = async () => { providerCalls++; return { url: 'https://invalid.test/retry.png', model: 'cogview-3-flash' }; };
    await processItem(worker, retried.items[0].id); await processItem(worker, retried.items[0].id);
    await recovery.tick();
    const final = await f.graph();
    assert.equal(final.nodes.filter(n => n.data.kind === 'image' && n.data.status === 'ready').length, 3);
    for (const n of graph.nodes.filter(n => n.data.kind === 'image' && n.data.status === 'ready')) assert.equal(final.nodes.find(current => current.id === n.id).data.assetId, n.data.assetId);
  });
  await t.test('disconnect immediately after planning continues in the background and never re-plans or bills chat twice', async () => {
    const tasks = new GenerationTasksService(db, config, queue, credits);
    const images = new CanvasImageToolsService(db, tasks, config);
    const f = await fixture(makePlan(1), db, images);
    const chat = new CanvasChatService(db, f.model, credits, config, f.agent);
    const before = await credits.balance(user.id);
    const stream = chat.sendStream(user.id, f.canvas.id, f.conversation.id, '根据story生成一张图片', [], signal(), ['story'], randomUUID());
    while (true) { const event = await stream.next(); if (event.done || event.value.event === 'plan') break; }
    await stream.return();
    let run = await db.canvasAgentRun.findFirstOrThrow({ where: { conversationId: f.conversation.id } });
    assert(run.deliveredAt); assert.equal(run.status, 'interrupted');
    assert.equal(await db.generationTask.count({ where: { canvasId: f.canvas.id } }), 0);
    const recovery = new CanvasGenerationRecovery(db, f.agent, f.mcp);
    await recovery.tick();
    const task = await db.generationTask.findFirstOrThrow({ where: { canvasId: f.canvas.id }, include: { items: true } });
    assert.equal(f.calls(), 1);
    // Active executors fence the reconciliation writer as well.
    const lease = await f.agent.claim(f.scope, f.conversation.id, run.requestId, run.input, true);
    await db.generationTaskItem.update({ where: { id: task.items[0].id }, data: { status: 'completed' } });
    await db.asset.update({ where: { id: task.items[0].assetId }, data: { status: 'ready', url: '/files/fixture.png' } });
    await tasks.refresh(task.id);
    await recovery.tick();
    assert.equal((await f.graph()).nodes[1].data.status, 'generating');
    await f.agent.store.release(lease);
    // Deleting a target never resurrects it; the generated asset stays in history.
    const graph = await f.graph(); graph.nodes = graph.nodes.filter(n => n.id !== task.nodeId); graph.edges = [];
    await db.canvas.update({ where: { id: f.canvas.id }, data: { graph } });
    await recovery.tick();
    run = await db.canvasAgentRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(run.status, 'completed'); assert.match(run.response, /生成历史/);
    assert.equal((await f.graph()).nodes.length, 1);
    assert.equal((await credits.balance(user.id)).spent - before.spent, 11);
    assert.equal(await db.canvasChatMessage.count({ where: { runId: run.id } }), 2);
    const session = await f.mcp.connect({ ...f.scope, canvasId: randomUUID() });
    try { assert((await session.client.callTool({ name: 'get_image_generation_status', arguments: { taskId: task.id } })).isError); }
    finally { await session.close(); }
  });
  await t.test('lost submission responses use the atomic receipt; unknown provider outcomes never resubmit automatically', async () => {
    const tasks = new GenerationTasksService(db, config, queue, credits);
    const original = tasks.create.bind(tasks);
    let submissions = 0;
    tasks.create = async (...args) => { submissions++; const result = await original(...args); if (submissions === 1) throw new Error('lost response after commit'); return result; };
    const f = await fixture(makePlan(1), db, new CanvasImageToolsService(db, tasks, config));
    const chat = new CanvasChatService(db, f.model, credits, config, f.agent);
    await collect(chat.sendStream(user.id, f.canvas.id, f.conversation.id, '根据story生成一张图片', [], signal(), ['story'], randomUUID()));
    assert.equal(submissions, 1);
    const run = await db.canvasAgentRun.findFirstOrThrow({ where: { conversationId: f.conversation.id } });
    assert(run.events.some(event => event.recoveredReceipt));
    const task = await db.generationTask.findFirstOrThrow({ where: { canvasId: f.canvas.id }, include: { items: true } });
    await db.generationTaskItem.update({ where: { id: task.items[0].id }, data: { status: 'unknown', error: '提交结果待确认', errorCode: 'SUBMISSION_UNKNOWN' } });
    await tasks.refresh(task.id);
    const recovery = new CanvasGenerationRecovery(db, f.agent, f.mcp);
    await recovery.tick(); await recovery.tick();
    assert.equal(submissions, 1); assert.equal(f.calls(), 1);
    assert.equal(await db.generationTask.count({ where: { canvasId: f.canvas.id } }), 1);
    assert.match((await db.canvasAgentRun.findUniqueOrThrow({ where: { id: run.id } })).response, /结果待确认/);
    await db.generationTaskItem.update({ where: { id: task.items[0].id }, data: { status: 'failed' } });
    await tasks.refresh(task.id); await recovery.tick();
    assert.equal((await db.canvasAgentRun.findUniqueOrThrow({ where: { id: run.id } })).status, 'completed_with_errors');
  });
  await t.test('failure to commit the MCP receipt rolls back the task, asset, graph flags and credit holds', async () => {
    const tasks = new GenerationTasksService(db, config, queue, credits);
    const original = tasks.create.bind(tasks);
    tasks.create = (userId, input, hooks) => original(userId, input, { ...hooks, commit: async (tx, task) => { await hooks.commit(tx, task); throw new Error('receipt transaction failed'); } });
    const images = new CanvasImageToolsService(db, tasks, config);
    const f = await fixture(makePlan(1), db, images);
    const before = await credits.balance(user.id);
    await assert.rejects(collect(f.run(request('根据story生成一张图片'))), /receipt transaction failed/);
    assert.equal(await db.generationTask.count({ where: { canvasId: f.canvas.id } }), 0);
    assert.equal(await db.asset.count({ where: { canvasId: f.canvas.id } }), 0);
    assert.equal((await f.graph()).nodes[1].data.status, 'idle');
    const after = await credits.balance(user.id);
    assert.equal(after.available, before.available); assert.equal(after.frozen, before.frozen);
  });
  await t.test('an older status snapshot cannot regress an already completed image or response', async () => {
    const tasks = new GenerationTasksService(db, config, queue, credits);
    const f = await fixture(makePlan(1), db, new CanvasImageToolsService(db, tasks, config));
    const chat = new CanvasChatService(db, f.model, credits, config, f.agent);
    await collect(chat.sendStream(user.id, f.canvas.id, f.conversation.id, '根据story生成一张图片', [], signal(), ['story'], randomUUID()));
    const run = await db.canvasAgentRun.findFirstOrThrow({ where: { conversationId: f.conversation.id }, include: { steps: true } });
    const step = run.steps.find(s => s.tool === 'generate_image');
    const taskId = step.result.generationTaskId;
    const old = await tasks.get(user.id, taskId);
    const item = old.items[0];
    await db.generationTaskItem.update({ where: { id: item.id }, data: { status: 'completed' } });
    await db.asset.update({ where: { id: item.asset.id }, data: { status: 'ready', url: '/files/completed.png' } });
    await tasks.refresh(taskId);
    const recovery = new CanvasGenerationRecovery(db, f.agent, f.mcp);
    await recovery.reconcile(run.id, f.scope, new Map([[step.id, await tasks.get(user.id, taskId)]]));
    assert.equal((await f.graph()).nodes[1].data.status, 'ready');
    await recovery.reconcile(run.id, f.scope, new Map([[step.id, old]]));
    assert.equal((await f.graph()).nodes[1].data.status, 'ready', 'a second PM2 instance may still hold a queued snapshot');
    assert.equal((await db.canvasAgentStep.findUniqueOrThrow({ where: { id: step.id } })).result.generationStatus, 'completed');
  });
  await t.test('queued generation stops when the user changes generation settings before submission', async () => {
    const tasks = new GenerationTasksService(db, config, queue, credits);
    const f = await fixture(makePlan(3), db, new CanvasImageToolsService(db, tasks, config));
    const chat = new CanvasChatService(db, f.model, credits, config, f.agent);
    await collect(chat.sendStream(user.id, f.canvas.id, f.conversation.id, '根据story生成三张分镜图片', [], signal(), ['story'], randomUUID()));
    const existing = await db.generationTask.findMany({ where: { canvasId: f.canvas.id }, include: { items: true } });
    for (const task of existing) {
      await db.generationTaskItem.updateMany({ where: { taskId: task.id }, data: { status: 'failed' } });
      await tasks.refresh(task.id);
    }
    const graph = await f.graph();
    const pending = graph.nodes.find(n => n.data.kind === 'image' && !n.data.generationTaskId);
    pending.data.generationSize = '1344x768';
    await db.canvas.update({ where: { id: f.canvas.id }, data: { graph } });
    const recovery = new CanvasGenerationRecovery(db, f.agent, f.mcp);
    await recovery.tick();
    const all = await db.generationTask.findMany({ where: { canvasId: f.canvas.id } });
    // Always clean up paid fixtures, including when this regression fails.
    for (const task of all) { await db.generationTaskItem.updateMany({ where: { taskId: task.id }, data: { status: 'failed' } }); await tasks.refresh(task.id); }
    assert.equal(all.length, existing.length, 'saved plans must not silently use newly selected generation settings');
    const run = await db.canvasAgentRun.findFirstOrThrow({ where: { conversationId: f.conversation.id } });
    assert.equal(run.errorCode, 'PRECONDITION_CHANGED');
    assert.equal((await f.graph()).nodes.find(n => n.id === pending.id).data.generationSize, '1344x768');
  });
  await t.test('stale whole-canvas autosave retains concurrent agent nodes and completed assets without losing local edits', async () => {
    const { CanvasesService } = require('../src/modules/canvases/canvases.service.ts');
    const tasks = new GenerationTasksService(db, config, queue, credits);
    const f = await fixture(makePlan(1), db, new CanvasImageToolsService(db, tasks, config));
    const chat = new CanvasChatService(db, f.model, credits, config, f.agent);
    await collect(chat.sendStream(user.id, f.canvas.id, f.conversation.id, '根据story生成一张图片', [], signal(), ['story'], randomUUID()));
    const base = await f.graph(), local = structuredClone(base);
    local.nodes[0].data.title = '本地修改保留'; local.nodes[0].position.x = 100;
    const task = await db.generationTask.findFirstOrThrow({ where: { canvasId: f.canvas.id }, include: { items: true } });
    await db.generationTaskItem.updateMany({ where: { taskId: task.id }, data: { status: 'completed' } });
    await db.asset.update({ where: { id: task.items[0].assetId }, data: { status: 'ready', url: '/files/autosave-result.png' } });
    await tasks.refresh(task.id);
    const recovery = new CanvasGenerationRecovery(db, f.agent, f.mcp);
    await recovery.tick();
    const current = await db.canvas.findUniqueOrThrow({ where: { id: f.canvas.id } });
    await f.mcp.tools.execute(f.scope, 'create_nodes', { expectedRevision: current.updatedAt.toISOString(), nodes: [{ kind: 'image', title: '后台新增', prompt: '新图片', referenceNodeIds: ['story'] }] });
    const canvases = new CanvasesService(db, credits);
    const updated = await canvases.update(user.id, f.canvas.id, { graph: local, baseGraph: base });
    assert.equal(updated.graph.nodes.length, 3);
    assert.equal(updated.graph.nodes[0].data.title, '本地修改保留'); assert.equal(updated.graph.nodes[0].position.x, 100);
    assert.equal(updated.graph.nodes.find(n => n.id === task.nodeId).data.status, 'ready');
    assert.equal(updated.graph.nodes.find(n => n.id === task.nodeId).data.url, '/files/autosave-result.png');
    assert.equal(updated.graph.edges.length, 2);
    await assert.rejects(canvases.update('foreign-user', f.canvas.id, { graph: local, baseGraph: base }), /not found/);
  });
  await t.test('two background API instances resume one saved plan without duplicate jobs, receipts or holds', async () => {
    const tasks = new GenerationTasksService(db, config, queue, credits);
    const f = await fixture(makePlan(3), db, new CanvasImageToolsService(db, tasks, config));
    const chat = new CanvasChatService(db, f.model, credits, config, f.agent);
    await collect(chat.sendStream(user.id, f.canvas.id, f.conversation.id, '根据story生成三张分镜图片', [], signal(), ['story'], randomUUID()));
    const initial = await db.generationTask.findMany({ where: { canvasId: f.canvas.id } });
    for (const task of initial) { await db.generationTaskItem.updateMany({ where: { taskId: task.id }, data: { status: 'failed' } }); await tasks.refresh(task.id); }
    const first = new CanvasGenerationRecovery(db, f.agent, f.mcp), second = new CanvasGenerationRecovery(db, f.agent, f.mcp);
    await Promise.all([first.tick(), second.tick()]);
    await Promise.all([first.tick(), second.tick()]);
    const all = await db.generationTask.findMany({ where: { canvasId: f.canvas.id } });
    for (const task of all) { await db.generationTaskItem.updateMany({ where: { taskId: task.id }, data: { status: 'failed' } }); await tasks.refresh(task.id); }
    await first.tick();
    assert.equal(all.length, 3);
    assert.equal(new Set(all.map(task => task.nodeId)).size, 3);
    assert.equal(await db.creditHold.count({ where: { referenceId: { in: all.map(task => task.id) } } }), 3);
    assert.equal(f.calls(), 1);
    assert.equal(await db.canvasChatMessage.count({ where: { conversationId: f.conversation.id } }), 2);
  });
  await t.test('insufficient media credits stop the saved plan without orphan assets, frozen credits or automatic retries', async () => {
    const before = await credits.balance(user.id);
    await db.creditAccount.update({ where: { userId: user.id }, data: { available: 1 } });
    try {
      const tasks = new GenerationTasksService(db, config, queue, credits);
      const f = await fixture(makePlan(1), db, new CanvasImageToolsService(db, tasks, config));
      const chat = new CanvasChatService(db, f.model, credits, config, f.agent);
      await assert.rejects(collect(chat.sendStream(user.id, f.canvas.id, f.conversation.id, '根据story生成一张图片', [], signal(), ['story'], randomUUID())), /积分不足/);
      const recovery = new CanvasGenerationRecovery(db, f.agent, f.mcp);
      await recovery.tick(); await recovery.tick();
      assert.equal(f.calls(), 1);
      assert.equal(await db.generationTask.count({ where: { canvasId: f.canvas.id } }), 0);
      assert.equal(await db.asset.count({ where: { canvasId: f.canvas.id } }), 0);
      const balance = await credits.balance(user.id);
      assert.equal(balance.frozen, 0); assert.equal(balance.spent - before.spent, 1);
      const detail = await chat.get(user.id, f.canvas.id, f.conversation.id);
      assert.equal(detail.agentRuns[0].backgroundPending, false);
      assert.equal(detail.agentRuns[0].status, 'partial');
    } finally { await db.creditAccount.update({ where: { userId: user.id }, data: { available: before.available } }); }
  });
  await t.test('a missing saved plan stops background execution instead of making a new model call', async () => {
    const tasks = new GenerationTasksService(db, config, queue, credits);
    const f = await fixture(makePlan(1), db, new CanvasImageToolsService(db, tasks, config));
    const chat = new CanvasChatService(db, f.model, credits, config, f.agent);
    const stream = chat.sendStream(user.id, f.canvas.id, f.conversation.id, '根据story生成一张图片', [], signal(), ['story'], randomUUID());
    while (true) { const next = await stream.next(); if (next.done || next.value.event === 'plan') break; }
    await stream.return();
    const run = await db.canvasAgentRun.findFirstOrThrow({ where: { conversationId: f.conversation.id } });
    await db.canvasAgentRun.update({ where: { id: run.id }, data: { plan: apiRequire('@reel/db').Prisma.JsonNull } });
    const recovery = new CanvasGenerationRecovery(db, f.agent, f.mcp);
    await recovery.tick();
    const updated = await db.canvasAgentRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(updated.status, 'failed'); assert.equal(updated.errorCode, 'CHECKPOINT_INVALID');
    assert.equal(f.calls(), 1); assert.equal(await db.generationTask.count({ where: { canvasId: f.canvas.id } }), 0);
    assert.equal((await f.graph()).nodes.length, 1);
  });
  await t.test('image-reference MCP generation uses the compatible model and rejects foreign assets before reserving generation credits', async () => {
    const storage = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'agent-image-reference-'));
    const localConfig = { get: key => key === 'STORAGE_DIR' ? storage : config.get(key) };
    const foreign = await db.user.create({ data: { email: `${randomUUID()}@invalid.test`, name: 'Foreign fixture' } });
    try {
      for (const owner of [user, foreign]) {
        const directory = path.join(storage, 'users', owner.id, 'uploads'); fs.mkdirSync(directory, { recursive: true });
        const file = path.join(directory, 'reference.png');
        fs.writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK0cAAAAASUVORK5CYII=', 'base64'));
        const folder = await db.assetFolder.create({ data: { userId: owner.id, name: '参考图片测试' } });
        const asset = await db.asset.create({ data: { userId: owner.id, folderId: folder.id, kind: 'image', source: 'upload', status: 'ready', name: '参考图片', url: `/files/users/${owner.id}/uploads/reference.png`, localPath: file } });
        const graph = { version: 1, nodes: [{ id: 'photo', type: 'workflow', position: { x: 0, y: 0 }, data: { kind: 'image', title: '参考图片', prompt: '', content: '', status: 'ready', uploaded: true, assetId: asset.id, url: asset.url } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
        const value = makePlan(1); value.steps[0].arguments.nodes[0].referenceNodeIds = ['photo'];
        const tasks = new GenerationTasksService(db, localConfig, queue, credits);
        const f = await fixture(value, db, new CanvasImageToolsService(db, tasks, localConfig), graph);
        const chat = new CanvasChatService(db, f.model, credits, localConfig, f.agent);
        const before = await credits.balance(user.id);
        const send = () => collect(chat.sendStream(user.id, f.canvas.id, f.conversation.id, '基于photo生成一张图片', [], signal(), ['photo'], randomUUID()));
        if (owner.id !== user.id) {
          await assert.rejects(send(), /参考图片不可用/);
          assert.equal(await db.generationTask.count({ where: { canvasId: f.canvas.id } }), 0);
          assert.equal((await credits.balance(user.id)).frozen, before.frozen);
        } else {
          await send();
          const task = await db.generationTask.findFirstOrThrow({ where: { canvasId: f.canvas.id } });
          assert.equal(task.model, 'Kwai-Kolors/Kolors'); assert.deepEqual(task.input.imageAssetIds, [asset.id]);
          assert.equal(task.input.references[0].assetId, asset.id);
          const session = await f.mcp.connect(f.scope);
          try {
            const response = await session.client.callTool({ name: 'generate_image', arguments: { nodeId: task.nodeId, expectedRevision: new Date().toISOString() } });
            assert(response.isError); assert.match(response.content[0].text, /已持久化/);
          } finally { await session.close(); }
          await db.generationTaskItem.updateMany({ where: { taskId: task.id }, data: { status: 'failed' } }); await tasks.refresh(task.id);
          await new CanvasGenerationRecovery(db, f.agent, f.mcp).tick();
        }
      }
    } finally { fs.rmSync(storage, { recursive: true, force: true }); }
  });
  await t.test('renaming a queued target and deleting an already submitted sibling do not invalidate the remaining media plan', async () => {
    const tasks = new GenerationTasksService(db, config, queue, credits);
    const f = await fixture(makePlan(3), db, new CanvasImageToolsService(db, tasks, config));
    const chat = new CanvasChatService(db, f.model, credits, config, f.agent);
    await collect(chat.sendStream(user.id, f.canvas.id, f.conversation.id, '根据story生成三张分镜图片', [], signal(), ['story'], randomUUID()));
    const initial = await db.generationTask.findMany({ where: { canvasId: f.canvas.id } });
    for (const task of initial) { await db.generationTaskItem.updateMany({ where: { taskId: task.id }, data: { status: 'failed' } }); await tasks.refresh(task.id); }
    const graph = await f.graph();
    const pending = graph.nodes.find(n => n.data.kind === 'image' && !n.data.generationTaskId);
    pending.data.title = '用户重命名的镜头';
    const deleted = initial[0].nodeId;
    graph.nodes = graph.nodes.filter(n => n.id !== deleted); graph.edges = graph.edges.filter(e => e.source !== deleted && e.target !== deleted);
    await db.canvas.update({ where: { id: f.canvas.id }, data: { graph } });
    const recovery = new CanvasGenerationRecovery(db, f.agent, f.mcp);
    await recovery.tick();
    let run = await db.canvasAgentRun.findFirstOrThrow({ where: { conversationId: f.conversation.id } });
    const all = await db.generationTask.findMany({ where: { canvasId: f.canvas.id } });
    for (const task of all) { await db.generationTaskItem.updateMany({ where: { taskId: task.id }, data: { status: 'failed' } }); await tasks.refresh(task.id); }
    assert.equal(run.status, 'waiting_generation', 'previously verified edits must not be checked against stale titles or intentionally deleted nodes');
    await recovery.tick();
    run = await db.canvasAgentRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(run.status, 'completed_with_errors'); assert.equal(f.calls(), 1);
    assert.equal((await f.graph()).nodes.find(n => n.id === pending.id).data.title, '用户重命名的镜头');
    assert(!(await f.graph()).nodes.some(n => n.id === deleted));
  });
  await t.test('explicitly resuming a failed save on the same generation task updates its original Agent run and message', async () => {
    for (const finishesBeforeScan of [false, true]) {
      const tasks = new GenerationTasksService(db, config, queue, credits);
      const f = await fixture(makePlan(1), db, new CanvasImageToolsService(db, tasks, config));
      const chat = new CanvasChatService(db, f.model, credits, config, f.agent);
      const before = await credits.balance(user.id);
      await collect(chat.sendStream(user.id, f.canvas.id, f.conversation.id, '根据story生成一张图片', [], signal(), ['story'], randomUUID()));
      const task = await db.generationTask.findFirstOrThrow({ where: { canvasId: f.canvas.id }, include: { items: true } });
      await db.generationTaskItem.updateMany({ where: { taskId: task.id }, data: { status: 'failed', providerResult: { url: 'https://invalid.test/result.png', model: task.model } } });
      await tasks.refresh(task.id);
      const recovery = new CanvasGenerationRecovery(db, f.agent, f.mcp);
      await recovery.tick();
      const run = await db.canvasAgentRun.findFirstOrThrow({ where: { conversationId: f.conversation.id } });
      assert.equal(run.status, 'completed_with_errors');
      await tasks.resume(user.id, task.id);
      const finish = async () => {
        await db.generationTaskItem.updateMany({ where: { taskId: task.id }, data: { status: 'completed', revision: { increment: 1 } } });
        await db.asset.update({ where: { id: task.items[0].assetId }, data: { status: 'ready', url: '/files/resumed.png' } });
        await tasks.refresh(task.id);
      };
      if (finishesBeforeScan) await finish();
      await recovery.tick();
      const active = await db.canvasAgentRun.findUniqueOrThrow({ where: { id: run.id } });
      // Clean up even before the assertion, so a failed regression cannot strand
      // a credit hold in the remaining scenarios.
      if (!finishesBeforeScan) await finish();
      assert.equal(active.status, finishesBeforeScan ? 'completed' : 'waiting_generation');
      await recovery.tick();
      const completed = await chat.get(user.id, f.canvas.id, f.conversation.id);
      assert.equal(completed.agentRuns[0].status, 'completed');
      assert.match(completed.messages.at(-1).content, /1 张成功/);
      assert.equal(f.calls(), 1); assert.equal((await credits.balance(user.id)).spent - before.spent, 11);
    }
  });
  await t.test('an older task finishing reconciliation cannot overwrite a newer task or its chat reply on the same node', async () => {
    const tasks = new GenerationTasksService(db, config, queue, credits);
    const f = await fixture(makePlan(1), db, new CanvasImageToolsService(db, tasks, config));
    const chat = new CanvasChatService(db, f.model, credits, config, f.agent);
    await collect(chat.sendStream(user.id, f.canvas.id, f.conversation.id, '根据story生成一张图片', [], signal(), ['story'], randomUUID()));
    const old = await db.generationTask.findFirstOrThrow({ where: { canvasId: f.canvas.id } });
    await db.generationTaskItem.updateMany({ where: { taskId: old.id }, data: { status: 'failed', revision: { increment: 1 } } });
    await tasks.refresh(old.id);
    const recovery = new CanvasGenerationRecovery(db, f.agent, f.mcp);
    await recovery.tick();
    const oldRun = await db.canvasAgentRun.findFirstOrThrow({ where: { conversationId: f.conversation.id }, include: { steps: true } });
    const oldStep = oldRun.steps.find(step => step.tool === 'generate_image');
    const snapshot = await tasks.get(user.id, old.id);
    const retryPlan = plan([{ id: 'new-task', description: '生成新的图片', tool: 'generate_image', arguments: { nodeId: old.nodeId } }]);
    const model = { chatStreamEvents: async function* () { yield submit(retryPlan); } };
    const retryAgent = new CanvasAgentService(f.mcp, model, db);
    const retryChat = new CanvasChatService(db, model, credits, config, retryAgent);
    await collect(retryChat.sendStream(user.id, f.canvas.id, f.conversation.id, '给这个图片节点生成一张新图片', [], signal(), [old.nodeId], randomUUID()));
    const current = await db.generationTask.findFirstOrThrow({ where: { canvasId: f.canvas.id, id: { not: old.id } }, include: { items: true } });
    await recovery.reconcile(oldRun.id, f.scope, new Map([[oldStep.id, snapshot]]));
    let node = (await f.graph()).nodes.find(n => n.id === old.nodeId);
    assert.equal(node.data.generationTaskId, current.id); assert.equal(node.data.status, 'generating');
    await db.generationTaskItem.updateMany({ where: { taskId: current.id }, data: { status: 'completed', revision: { increment: 1 } } });
    await db.asset.update({ where: { id: current.items[0].assetId }, data: { status: 'ready', url: '/files/new-task.png' } });
    await tasks.refresh(current.id); await recovery.tick();
    await recovery.reconcile(oldRun.id, f.scope, new Map([[oldStep.id, snapshot]]));
    node = (await f.graph()).nodes.find(n => n.id === old.nodeId);
    assert.equal(node.data.assetId, current.items[0].assetId); assert.equal(node.data.url, '/files/new-task.png');
    const detail = await retryChat.get(user.id, f.canvas.id, f.conversation.id);
    assert.match(detail.messages.at(-1).content, /1 张成功/);
    assert.equal(detail.messages.length, 4);
  });
  await t.test('resuming a submitted item of a stopped plan refreshes its receipt without restarting rejected pending steps', async () => {
    const tasks = new GenerationTasksService(db, config, queue, credits);
    const f = await fixture(makePlan(3), db, new CanvasImageToolsService(db, tasks, config));
    const chat = new CanvasChatService(db, f.model, credits, config, f.agent);
    await collect(chat.sendStream(user.id, f.canvas.id, f.conversation.id, '根据story生成三张分镜图片', [], signal(), ['story'], randomUUID()));
    const initial = await db.generationTask.findMany({ where: { canvasId: f.canvas.id }, include: { items: true } });
    for (const task of initial) {
      await db.generationTaskItem.updateMany({ where: { taskId: task.id }, data: { status: 'failed', revision: { increment: 1 }, providerResult: { url: 'https://invalid.test/result.png', model: task.model } } }); await tasks.refresh(task.id);
    }
    const graph = await f.graph(); graph.nodes.find(n => n.data.kind === 'image' && !n.data.generationTaskId).data.generationSize = '1344x768';
    await db.canvas.update({ where: { id: f.canvas.id }, data: { graph } });
    const recovery = new CanvasGenerationRecovery(db, f.agent, f.mcp); await recovery.tick();
    let run = await db.canvasAgentRun.findFirstOrThrow({ where: { conversationId: f.conversation.id } });
    assert.equal(run.status, 'partial'); assert.equal(run.errorCode, 'PRECONDITION_CHANGED');
    const resumed = await tasks.resume(user.id, initial[0].id); await recovery.tick();
    run = await db.canvasAgentRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(run.status, 'partial');
    const step = await db.canvasAgentStep.findUniqueOrThrow({ where: { id: resumed.requestId } });
    assert.equal(step.result.generationRevision, resumed.revision);
    await db.generationTaskItem.updateMany({ where: { taskId: resumed.id }, data: { status: 'completed', revision: { increment: 1 } } });
    await db.asset.update({ where: { id: initial[0].items[0].assetId }, data: { status: 'ready', url: '/files/partial-resume.png' } });
    await tasks.refresh(resumed.id); await recovery.tick();
    assert.equal((await f.graph()).nodes.find(n => n.id === resumed.nodeId).data.url, '/files/partial-resume.png');
    assert.equal(await db.generationTask.count({ where: { canvasId: f.canvas.id } }), 2); assert.equal(f.calls(), 1);
  });
  await db.platformSetting.update({ where: { key: 'maxConcurrent' }, data: { value: 3 } });
});

test('live creation with content then rename resolves outputs on primary and fallback models', { skip: process.env.LIVE_AGENT_SMOKE !== '1', timeout: 240000 }, async () => {
  assert(process.env.GLM_API_KEY);
  const f = await fixture();
  const { GlmProvider } = apiRequire('@reel/llm');
  const model = new GlmProvider({ apiKey: process.env.GLM_API_KEY, baseUrl: process.env.GLM_BASE_URL });
  const agent = new CanvasAgentService(f.mcp, model, db);
  for (const name of ['glm-4.6v-flash', 'glm-4.1v-thinking-flash']) {
    const before = await f.graph();
    const ids = new Set(before.nodes.map(node => node.id));
    await collect(agent.run(f.scope, f.conversation.id, [
      { role: 'user', content: '之前帮我创建过几个分镜节点。' },
      { role: 'assistant', content: '已完成之前的创建任务。' },
      ...request('创建一个名为临时说明的文本节点，内容为测试内容，然后把它重命名为最终说明'),
    ], name, signal()));
    const graph = await f.graph();
    const added = graph.nodes.filter(node => !ids.has(node.id));
    assert.equal(added.length, 1, name);
    assert.equal(added[0].data.title, '最终说明', name);
    assert.equal(added[0].data.content, '测试内容', name);
    assert.deepEqual(graph.nodes.filter(node => ids.has(node.id)), before.nodes, name);
    const run = await db.canvasAgentRun.findFirst({ where: { conversationId: f.conversation.id }, orderBy: { createdAt: 'desc' } });
    assert.equal(run.status, 'completed', name);
    assert(run.plan.steps.some(step => step.tool === 'create_nodes'), name);
    assert(run.plan.steps.some(step => step.tool === 'rename_node'), name);
  }
});

test('live phase two planner creates, references and generates three images through MCP', { skip: process.env.LIVE_AGENT_SMOKE !== '1', timeout: 180000 }, async () => {
  assert(process.env.GLM_API_KEY);
  const { GenerationTasksService } = require('../src/modules/generation-tasks/generation-tasks.service.ts');
  const { CanvasImageToolsService } = require('../src/modules/canvas-agent/canvas-image-tools.service.ts');
  const { CanvasGenerationRecovery } = require('../src/modules/canvas-agent/canvas-generation-recovery.service.ts');
  const { GenerationTasksProcessor } = require('../src/modules/generation-tasks/generation-tasks.processor.ts');
  const config = { get: key => ({ GLM_IMAGE_MODEL: 'cogview-3-flash', GLM_API_KEY: 'fake', STORAGE_DIR: '/tmp' })[key] };
  const credits = new CreditsService(db, config);
  await credits.balance(user.id);
  await db.creditAccount.update({ where: { userId: user.id }, data: { available: 1000 } });
  const tasks = new GenerationTasksService(db, config, { add: async () => {} }, credits);
  const f = await fixture(undefined, db, new CanvasImageToolsService(db, tasks, config));
  const provider = new (apiRequire('@reel/llm').GlmProvider)({ apiKey: process.env.GLM_API_KEY, baseUrl: process.env.GLM_BASE_URL });
  const outputs = [];
  const llm = { chatStreamEvents: async function* (...args) {
    let text = '';
    try { for await (const event of provider.chatStreamEvents(...args)) { if (event.type === 'text') text += event.text; yield event; } }
    finally { outputs.push(text); }
  } };
  const agent = new CanvasAgentService(f.mcp, llm, db);
  const chat = new CanvasChatService(db, llm, credits, config, agent);
  const events = await collect(chat.sendStream(user.id, f.canvas.id, f.conversation.id, '根据故事节点story拆成三个分镜，创建三个图片节点，分别填写画面提示词并实际生成三张图片。每个图片节点都引用故事。', [], AbortSignal.timeout(150000), ['story'], randomUUID())).catch(error => {
    // Only this synthetic test story and model-generated plan are included.
    throw new Error(`${error.message}\nFixture planner outputs: ${JSON.stringify(outputs)}`, { cause: error });
  });
  assert(events.findIndex(e => e.event === 'plan') < events.findIndex(e => e.event === 'canvas'));
  const run = await db.canvasAgentRun.findFirstOrThrow({ where: { conversationId: f.conversation.id } });
  assert.equal(run.plan.steps.filter(step => step.tool === 'generate_image').length, 3);
  assert.equal((await f.graph()).nodes.length, 4);
  assert.equal((await f.graph()).edges.length, 3);
  const worker = new GenerationTasksProcessor(db, tasks, config, {});
  let providerCalls = 0;
  worker.provider = { generateImage: async () => { providerCalls++; return { url: 'https://invalid.test/fixture.png', model: 'cogview-3-flash' }; } };
  worker.saveMedia = async id => ({ url: `/files/users/${user.id}/generated/${id}.png`, localPath: `/tmp/${id}.png`, width: 1024, height: 1024 });
  const recovery = new CanvasGenerationRecovery(db, agent, f.mcp);
  for (let round = 0; round < 5; round++) {
    const pending = await db.generationTaskItem.findMany({ where: { task: { canvasId: f.canvas.id }, status: { in: ['queued', 'saving'] } } });
    for (const item of pending) await worker.process({ data: { id: item.id, revision: item.revision } });
    await recovery.tick();
  }
  assert.equal(providerCalls, 3);
  assert.equal((await db.canvasAgentRun.findUniqueOrThrow({ where: { id: run.id } })).status, 'completed');
  assert.equal((await f.graph()).nodes.filter(n => n.data.kind === 'image' && n.data.status === 'ready' && n.data.assetId && n.data.url).length, 3);
});

test('live Plan & Execute renames then creates a referenced video on a populated canvas', { skip: process.env.LIVE_AGENT_SMOKE !== '1', timeout: 120000 }, async () => {
  assert(process.env.GLM_API_KEY);
  const f = await fixture();
  const graph = await f.graph();
  for (let index = 0; index < 28; index++) graph.nodes.push({ id: randomUUID(), type: 'workflow', position: { x: index * 520, y: 500 }, data: { kind: 'image', title: '图片', prompt: '', content: '', status: 'idle' } });
  await db.canvas.update({ where: { id: f.canvas.id }, data: { graph } });
  const { GlmProvider } = apiRequire('@reel/llm');
  const llm = new GlmProvider({ apiKey: process.env.GLM_API_KEY, baseUrl: process.env.GLM_BASE_URL });
  const agent = new CanvasAgentService(f.mcp, llm, db);
  const events = await collect(agent.run(f.scope, f.conversation.id, request('本轮只把节点story的名称改为测试agent，不创建其他节点。'), 'glm-4.6v-flash', signal()));
  assert.equal((await f.graph()).nodes[0].data.title, '测试agent');
  assert.equal((await f.graph()).nodes.length, 29);
  assert(events.findIndex(e => e.event === 'plan') < events.findIndex(e => e.event === 'canvas'));
  await collect(agent.run(f.scope, f.conversation.id, request('引用文本节点story，创建且只创建一个视频节点，不生成媒体。'), 'glm-4.6v-flash', signal()));
  const result = await f.graph();
  assert.equal(result.nodes.length, 30);
  const video = result.nodes.find(n => n.data.kind === 'video');
  assert(video);
  assert(result.edges.some(e => e.source === 'story' && e.target === video.id));
  const previousIds = new Set(result.nodes.map(node => node.id));
  const previousRight = Math.max(...result.nodes.map(node => node.position.x + (node.data.kind === 'video' ? 640 : 360)));
  await collect(agent.run(f.scope, f.conversation.id, request('基于选中的故事节点story，创建两个图片节点，每个都依赖这个故事，只创建节点，不生成媒体。'), 'glm-4.6v-flash', signal()));
  const storyboard = await f.graph();
  const created = storyboard.nodes.filter(node => !previousIds.has(node.id));
  assert.equal(created.length, 2);
  assert.equal(created[0].position.x, created[1].position.x);
  assert(created[1].position.y >= created[0].position.y + 560);
  for (const node of created) {
    assert.equal(node.data.kind, 'image');
    assert(node.data.referenceNodeIds.includes('story'));
    assert(storyboard.edges.some(edge => edge.source === 'story' && edge.target === node.id));
    assert(node.position.x >= previousRight + 160);
  }
});
