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
const { PlanSchema, parsePlanJson, parsePlanCandidate, requestIsReadOnly, bindCreatedNodeReferences, bindRequestLiterals, bindRequestReferences, resolveArguments, validateReferences, validateRequestBounds } = require('../src/modules/canvas-agent/agent-plan.ts');
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
async function fixture(value = plan([rename()]), customDb = db) {
  const graph = { version: 1, nodes: [{ id: 'story', type: 'workflow', position: { x: 0, y: 0 }, data: { kind: 'text', title: '故事', prompt: '', content: '小狗出门、迷路、遇到朋友、一起回家', status: 'ready' } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
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
  const mcp = new CanvasMcpService(new CanvasToolsService(customDb));
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
