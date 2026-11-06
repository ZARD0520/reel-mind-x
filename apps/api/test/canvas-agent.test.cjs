const { test } = require('node:test');
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
const { CanvasAgentService, CREATIVE_AGENT_PROMPT } = require('../src/modules/canvas-agent/canvas-agent.service.ts');
const { GlmProvider } = require('../../../packages/llm/src/providers/glm.ts');
const { CanvasMcpController } = require('../src/modules/canvas-agent/canvas-mcp.controller.ts');
const { streamAgentModel, chatAgentModel, PRIMARY_AGENT_MODEL, FALLBACK_AGENT_MODEL } = require('../src/modules/canvas-agent/model-retry.ts');
const { LlmError } = apiRequire('@reel/llm');
const { chatErrorMessage, CHAT_BUSY_MESSAGE, CHAT_FAILURE_MESSAGE } = apiRequire('@reel/contracts');
const { CanvasChatController } = require('../src/modules/canvas-chat/canvas-chat.controller.ts');
const { CanvasChatService } = require('../src/modules/canvas-chat/canvas-chat.service.ts');
const { streamPromptTools } = require('../../../packages/llm/src/providers/prompt-tools.ts');

function fixture() {
  let row = { id: randomUUID(), userId: 'owner', updatedAt: new Date(), graph: {
    version: 1, nodes: [{ id: 'story', type: 'workflow', position: { x: 0, y: 0 }, data: { kind: 'text', title: '故事', content: '小狗出门、迷路、遇到朋友、一起回家', prompt: '', status: 'ready' } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 },
  } };
  const runs = [];
  const prisma = {
    canvas: {
      findFirst: async ({ where }) => where.id === row.id && where.userId === row.userId ? structuredClone(row) : null,
      updateMany: async ({ where, data }) => {
        if (where.updatedAt.getTime() !== row.updatedAt.getTime() || where.userId !== row.userId) return { count: 0 };
        row = { ...row, ...structuredClone(data) }; return { count: 1 };
      },
    },
    asset: { findMany: async () => [] },
    canvasAgentRun: {
      create: async ({ data }) => { const run = { id: randomUUID(), status: 'running', ...data }; runs.push(run); return run; },
      update: async ({ where, data }) => { const run = runs.find(r => r.id === where.id); Object.assign(run, structuredClone(data)); return run; },
    },
  };
  const tools = new CanvasToolsService(prisma);
  const scope = { canvasId: row.id, userId: row.userId, selectedNodeIds: ['story', 'missing'] };
  return { prisma, tools, scope, mcp: new CanvasMcpService(tools), runs, graph: () => row.graph };
}
const call = (name, args) => ({ type: 'tool_calls', calls: [{ id: randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

test('chat errors use short product messages without provider details', () => {
  assert.equal(chatErrorMessage(new LlmError('GLM API 调用失败 (429): {"error":{"code":"1305","message":"busy"}}', 429)), CHAT_BUSY_MESSAGE);
  assert.equal(chatErrorMessage('GLM API 调用失败 (429): internal diagnostics'), CHAT_BUSY_MESSAGE);
  assert.equal(chatErrorMessage(new LlmError('https://private-provider.test/internal request failed: configuration details', 502)), CHAT_FAILURE_MESSAGE);
  assert.equal(chatErrorMessage(CHAT_BUSY_MESSAGE), CHAT_BUSY_MESSAGE);
});

test('chat HTTP errors replace partial output with a persisted ordinary assistant turn', async (t) => {
  const raw = new LlmError('GLM API 调用失败 (429): {"error":{"code":"1305","message":"provider diagnostics"}}', 429);
  const conversation = { id: 'conversation', messages: [{ role: 'user', content: 'hello', references: [] }, { role: 'assistant', content: CHAT_BUSY_MESSAGE, references: [] }] };
  let saved;
  const chat = {
    assertConversation: async () => {},
    sendStream: async function* () { yield { event: 'delta', data: { text: 'partial answer' } }; throw raw; },
    saveErrorTurn: async (...args) => { saved = args; return conversation; },
  };
  const controller = new CanvasChatController(chat);
  t.mock.method(controller.logger, 'error', () => {});
  let output = '';
  const response = { writableEnded: false, on: () => {}, setHeader: () => {}, flushHeaders: () => {}, write: value => { output += value; }, end: () => { response.writableEnded = true; } };
  await controller.send({ id: 'owner' }, 'canvas', 'conversation', { content: 'hello', references: [], selectedNodeIds: [] }, response);
  assert.equal(saved[5], raw);
  assert.match(output, /event: replace/);
  assert.match(output, /event: done/);
  assert(output.includes(CHAT_BUSY_MESSAGE));
  assert(!output.includes('provider diagnostics'));
  assert(!output.includes('GLM API'));
});

test('failed turns persist both the question and sanitized assistant reply without charging credits', async () => {
  const messages = [];
  const conversation = { id: 'conversation' };
  const prisma = {
    canvasConversation: { findFirst: async () => conversation, update: async () => conversation },
    canvasChatMessage: { create: async ({ data }) => { messages.push(data); return data; }, findMany: async () => messages },
    canvasAgentRun: { findMany: async () => [] },
    $transaction: async work => work(prisma),
  };
  const service = new CanvasChatService(prisma, {}, {}, {}, {});
  const result = await service.saveErrorTurn('owner', 'canvas', 'conversation', '用户的问题', [], new LlmError('upstream failed', 429));
  assert.deepEqual(result.messages.map(message => [message.role, message.content]), [['user', '用户的问题'], ['assistant', CHAT_BUSY_MESSAGE]]);
});

test('real MCP discovery, scoped reads, validation, prompt updates, connections and stale revision rejection', async () => {
  const f = fixture();
  const session = await f.mcp.connect(f.scope);
  try {
    const names = (await session.client.listTools()).tools.map(tool => tool.name);
    assert.deepEqual(names.sort(), ['connect_nodes', 'create_nodes', 'get_canvas_context', 'update_node_prompt']);
    assert(!names.some(name => /generation|render|delete/.test(name)));
    const context = (await session.client.callTool({ name: 'get_canvas_context', arguments: {} })).structuredContent;
    assert.deepEqual(context.selectedNodeIds, ['story']);
    const created = await session.client.callTool({ name: 'create_nodes', arguments: { expectedRevision: context.revision, nodes: [{ kind: 'image', title: '镜头1', prompt: '小狗出门' }] } });
    assert.equal(created.isError, undefined);
    const nodeId = created.structuredContent.createdNodes[0].id;
    const stale = await session.client.callTool({ name: 'update_node_prompt', arguments: { expectedRevision: context.revision, nodeId, prompt: 'stale' } });
    assert.equal(stale.isError, true);
    assert.equal(f.graph().nodes[1].data.prompt, '小狗出门');
    const updated = await session.client.callTool({ name: 'update_node_prompt', arguments: { expectedRevision: created.structuredContent.revision, nodeId, prompt: '阳光下的小狗' } });
    const connected = await session.client.callTool({ name: 'connect_nodes', arguments: { expectedRevision: updated.structuredContent.revision, connections: [{ source: 'story', target: nodeId }] } });
    assert.equal(f.graph().edges.length, 1);
    assert.deepEqual(f.graph().nodes[1].data.referenceNodeIds, ['story']);
    assert.match(f.graph().nodes[1].data.prompt, /node:story/);
    const cycle = await session.client.callTool({ name: 'connect_nodes', arguments: { expectedRevision: connected.structuredContent.revision, connections: [{ source: nodeId, target: 'story' }] } });
    assert.equal(cycle.isError, true);
    const invalid = await session.client.callTool({ name: 'create_nodes', arguments: { expectedRevision: connected.structuredContent.revision, nodes: [{ kind: 'image', title: 'evil', assetId: 'other-users-asset' }] } });
    assert.equal(invalid.isError, true);
    assert.equal(f.graph().nodes.length, 2);
    const tooMany = await session.client.callTool({ name: 'create_nodes', arguments: { expectedRevision: connected.structuredContent.revision, nodes: Array.from({ length: 21 }, () => ({ kind: 'text', title: 'x' })) } });
    assert.equal(tooMany.isError, true);
    await assert.rejects(f.tools.read({ ...f.scope, userId: 'someone-else' }), /无权访问/);
    await assert.rejects(f.tools.read({ ...f.scope, canvasId: randomUUID() }), /无权访问/);
  } finally { await session.close(); }
});

test('LangGraph completes four storyboard nodes through MCP, connects story and persists progress', async () => {
  const f = fixture();
  let step = 0;
  const model = { chatStreamEvents: async function* (messages, options) {
    assert.equal(options.model, 'glm-4.6v-flash');
    assert.equal(options.tools.length, 4);
    if (step++ === 0) { yield call('get_canvas_context', {}); return; }
    const result = JSON.parse(messages.at(-1).content);
    if (step === 2) { yield call('create_nodes', { expectedRevision: result.revision, nodes: ['出门', '迷路', '相遇', '回家'].map(title => ({ kind: 'image', title, prompt: `分镜画面：${title}` })) }); return; }
    if (step === 3) { yield call('connect_nodes', { expectedRevision: result.revision, connections: result.createdNodes.map(node => ({ source: 'story', target: node.id })) }); return; }
    yield { type: 'text', text: '已创建四个分镜节点并关联故事。' };
  } };
  const agent = new CanvasAgentService(f.mcp, model, f.prisma);
  const events = [];
  for await (const event of agent.run(f.scope, randomUUID(), [{ role: 'system', content: CREATIVE_AGENT_PROMPT }, { role: 'user', content: '根据选中的故事创建四个分镜节点' }], 'glm-4.6v-flash', new AbortController().signal)) events.push(event);
  assert.equal(f.graph().nodes.length, 5);
  assert.equal(f.graph().edges.length, 4);
  assert.equal(events.filter(event => event.event === 'canvas').length, 2);
  assert.equal(events.filter(event => event.event === 'tool' && event.data.status === 'completed').length, 4);
  assert.equal(events.at(-1).data.text, '已创建四个分镜节点并关联故事。');
  assert.equal(f.runs[0].status, 'completed');
  assert.equal(f.runs[0].events.length, 8);
});

test('MCP HTTP endpoint supports SDK initialize/list/call and rejects untrusted browser origins', async () => {
  const f = fixture();
  const { createServer } = require('node:http');
  const { Client } = apiRequire('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = apiRequire('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const controller = new CanvasMcpController(f.mcp, f.tools, { get: () => 'http://allowed.test' });
  const server = createServer(async (request, response) => {
    try {
      const buffers = [];
      for await (const chunk of request) buffers.push(chunk);
      const body = Buffer.concat(buffers).toString();
      await controller.handle({ id: f.scope.userId }, f.scope.canvasId, request, response, body ? JSON.parse(body) : undefined);
    } catch (error) { response.statusCode = 500; response.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = new URL(`http://127.0.0.1:${server.address().port}/canvases/${f.scope.canvasId}/mcp`);
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(url));
    assert.equal((await client.listTools()).tools.length, 4);
    const context = await client.callTool({ name: 'get_canvas_context', arguments: {} });
    assert.equal(context.structuredContent.nodes[0].id, 'story');
    const response = await fetch(url, { method: 'POST', headers: { origin: 'https://untrusted.test', 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(response.status, 403);
  } finally { await client.close(); await new Promise(resolve => server.close(resolve)); }
});

test('tool errors reach model, failed model runs preserve committed changes and audit', async () => {
  const f = fixture();
  let step = 0;
  const model = { chatStreamEvents: async function* (messages) {
    if (step++ === 0) { yield call('get_canvas_context', {}); return; }
    const result = JSON.parse(messages.at(-1).content);
    if (step === 2) { yield call('create_nodes', { expectedRevision: result.revision, nodes: [{ kind: 'image', title: '已创建的镜头' }] }); return; }
    if (step === 3) { yield call('submit_generation', {}); return; }
    assert.equal(result.isError, true);
    throw new Error('provider disconnected');
  } };
  const agent = new CanvasAgentService(f.mcp, model, f.prisma);
  await assert.rejects(async () => { for await (const _ of agent.run(f.scope, randomUUID(), [], 'glm-4.6v-flash', new AbortController().signal)) {} }, /provider disconnected/);
  assert.equal(f.graph().nodes.length, 2);
  assert.equal(f.runs[0].status, 'failed');
  assert(f.runs[0].events.some(event => event.status === 'failed' && event.name === 'submit_generation'));
});

test('an instructional reply is withheld and corrected into an actual referenced video node', async () => {
  const f = fixture();
  f.graph().nodes[0].data = { kind: 'image', title: '图片', status: 'ready' };
  let step = 0;
  const model = { chatStreamEvents: async function* (messages) {
    const context = JSON.parse(messages.find(message => message.role === 'tool').content);
    if (step++ === 0) { yield { type: 'text', text: '请先执行 get_canvas_context()，然后假设 old_image_id，调用 create_nodes。' }; return; }
    if (step === 2) {
      assert.equal(messages.at(-1).role, 'system');
      yield call('create_nodes', { expectedRevision: context.revision, nodes: [{ kind: 'video', title: '参考视频', referenceNodeIds: ['story'] }] });
      return;
    }
    yield { type: 'text', text: '已创建视频节点并关联参考图片。' };
  } };
  const events = [];
  for await (const event of new CanvasAgentService(f.mcp, model, f.prisma).run(f.scope, randomUUID(), [{ role: 'user', content: '引用该节点，创建一个新的视频节点' }], PRIMARY_AGENT_MODEL, new AbortController().signal)) events.push(event);
  assert.equal(f.graph().nodes.length, 2);
  assert.equal(f.graph().nodes[1].data.kind, 'video');
  assert.equal(f.graph().edges[0].source, 'story');
  assert.equal(f.graph().edges[0].target, f.graph().nodes[1].id);
  assert.equal(events.filter(event => event.event === 'delta').map(event => event.data.text).join(''), '已创建视频节点并关联参考图片。');
  assert.equal(f.runs[0].events.filter(event => event.name === 'create_nodes' && event.status === 'completed').length, 1);
});

test('repeated tool tutorials and fabricated completion never mark a run successful', async () => {
  for (const reply of ['请先执行 get_canvas_context，然后调用 create_nodes。', '已创建新的视频节点。']) {
    const f = fixture();
    const model = { chatStreamEvents: async function* () { yield { type: 'text', text: reply }; } };
    const events = [];
    await assert.rejects(async () => { for await (const event of new CanvasAgentService(f.mcp, model, f.prisma).run(f.scope, randomUUID(), [{ role: 'user', content: '创建节点' }], PRIMARY_AGENT_MODEL, new AbortController().signal)) events.push(event); }, /未完成/);
    assert.equal(f.runs[0].status, 'failed');
    assert.equal(f.graph().nodes.length, 1);
    assert.equal(events.filter(event => event.event === 'delta').length, 0);
  }
});

test('creating nodes with invalid references rolls back the entire MCP edit', async () => {
  const f = fixture();
  const context = await f.tools.execute(f.scope, 'get_canvas_context', {});
  await assert.rejects(f.tools.execute(f.scope, 'create_nodes', { expectedRevision: context.revision, nodes: [{ kind: 'video', title: '视频', referenceNodeIds: ['missing'] }] }), /不存在/);
  assert.equal(f.graph().nodes.length, 1);
  assert.equal(f.graph().edges.length, 0);
});

test('stream cancellation closes run; execution loop has a finite step limit', async () => {
  const f = fixture();
  const model = { chatStreamEvents: async function* () { yield call('get_canvas_context', {}); } };
  const agent = new CanvasAgentService(f.mcp, model, f.prisma);
  const stream = agent.run(f.scope, randomUUID(), [], 'glm-4.6v-flash', new AbortController().signal);
  await stream.next();
  await stream.return();
  assert.equal(f.runs[0].status, 'cancelled');
  await assert.rejects(async () => { for await (const _ of agent.run(f.scope, randomUUID(), [], 'glm-4.6v-flash', new AbortController().signal)) {} }, /步数上限/);
  assert.equal(f.runs[1].status, 'failed');
});

test('429 switches to backup for the rest of the turn without repeating committed MCP changes', async () => {
  const models = [];
  const f = fixture();
  let step = 0;
  let rejected = false;
  const model = { chatStreamEvents: async function* (messages, options) {
    models.push(options.model);
    if (step === 0) { step++; yield call('get_canvas_context', {}); return; }
    const result = JSON.parse(messages.at(-1).content);
    if (step === 1) { step++; yield call('create_nodes', { expectedRevision: result.revision, nodes: [{ kind: 'image', title: '镜头' }] }); return; }
    if (!rejected) { rejected = true; throw new LlmError('busy', 429); }
    if (step === 2) { step++; yield call('get_canvas_context', {}); return; }
    yield { type: 'text', text: '已创建镜头' };
  } };
  const agent = new CanvasAgentService(f.mcp, model, f.prisma);
  const events = [];
  for await (const event of agent.run(f.scope, randomUUID(), [], 'glm-4.6v-flash', new AbortController().signal)) events.push(event);
  assert.deepEqual(models, [PRIMARY_AGENT_MODEL, PRIMARY_AGENT_MODEL, PRIMARY_AGENT_MODEL, FALLBACK_AGENT_MODEL, FALLBACK_AGENT_MODEL]);
  assert.equal(events.filter(event => event.event === 'status').length, 1);
  assert.equal(events.filter(event => event.event === 'canvas').length, 1);
  assert.equal(f.graph().nodes.length, 2);
  assert.equal(f.runs[0].status, 'completed');
});

test('model fallback is bounded, skips other errors and never replays partial output', async () => {
  const cases = [
    { status: 429, partial: false, expectedAttempts: 2 },
    { status: 400, partial: false, expectedAttempts: 1 },
    { status: 429, partial: true, expectedAttempts: 1 },
    { status: 429, partial: false, expectedAttempts: 1, model: FALLBACK_AGENT_MODEL },
  ];
  for (const scenario of cases) {
    let attempts = 0;
    const models = [];
    const llm = { chatStreamEvents: async function* (_messages, options) {
      attempts++;
      models.push(options.model);
      if (scenario.partial) yield { type: 'text', text: 'partial' };
      throw new LlmError('fixture error', scenario.status);
    } };
    await assert.rejects(async () => { for await (const _ of streamAgentModel(llm, [], { model: scenario.model ?? PRIMARY_AGENT_MODEL }, () => {})) {} }, /fixture error/);
    assert.equal(attempts, scenario.expectedAttempts);
    if (scenario.expectedAttempts === 2) assert.deepEqual(models, [PRIMARY_AGENT_MODEL, FALLBACK_AGENT_MODEL]);
  }
});

test('fallback preserves images and tool history, and is disabled after cancellation', async () => {
  const messages = [{ role: 'user', content: '描述图片', images: ['data:image/png;base64,fixture'] }, { role: 'tool', content: '{}', tool_call_id: 'previous-call' }];
  const tools = [{ type: 'function', function: { name: 'get_canvas_context', parameters: { type: 'object' } } }];
  let attempts = 0;
  const llm = { chatStreamEvents: async function* (received, options) {
    assert.equal(received, messages);
    assert.equal(options.tools, tools);
    if (++attempts === 1) throw new LlmError('busy', 429);
    yield { type: 'text', text: '备用回复' };
  } };
  const events = [];
  for await (const event of streamAgentModel(llm, messages, { model: PRIMARY_AGENT_MODEL, tools }, () => {})) events.push(event);
  assert.equal(events[0].text, '备用回复');
  const abort = new AbortController();
  let switched = false;
  const cancelled = { chatStreamEvents: async function* () { abort.abort(); throw new LlmError('busy', 429); } };
  await assert.rejects(async () => { for await (const _ of streamAgentModel(cancelled, [], { model: PRIMARY_AGENT_MODEL, signal: abort.signal }, () => { switched = true; })) {} }, /busy/);
  assert.equal(switched, false);
});

test('conversation title requests also switch on 429', async () => {
  const models = [];
  const llm = { chat: async (_messages, options) => {
    models.push(options.model);
    assert.equal(options.maxTokens, 48);
    if (models.length === 1) throw new LlmError('busy', 429);
    return { text: '新标题', model: FALLBACK_AGENT_MODEL };
  } };
  const result = await chatAgentModel(llm, [], { model: PRIMARY_AGENT_MODEL, maxTokens: 48 });
  assert.equal(result.text, '新标题');
  assert.deepEqual(models, [PRIMARY_AGENT_MODEL, FALLBACK_AGENT_MODEL]);
});

test('backup tool compatibility hides control JSON, retains images and rejects unknown tools', async () => {
  const tools = [{ type: 'function', function: { name: 'get_canvas_context', parameters: { type: 'object' } } }];
  const images = ['data:image/png;base64,fixture'];
  const source = [{ role: 'user', content: '读取画布', images }];
  const request = async function* (messages, options) {
    assert.equal(options.tools, undefined);
    assert.deepEqual(messages[1].images, images);
    assert(messages[1].content.includes('get_canvas_context'));
    yield { type: 'text', text: '<|begin_of_box|>{"type":"tool_' };
    yield { type: 'text', text: 'call","name":"get_canvas_context","arguments":{}}<|end_of_box|>' };
  };
  const events = [];
  for await (const event of streamPromptTools(request, source, { model: FALLBACK_AGENT_MODEL, tools })) events.push(event);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'tool_calls');
  assert.equal(events[0].calls[0].function.name, 'get_canvas_context');
  const reply = async function* () { yield { type: 'text', text: '{"type":"message","content":"完成"}' }; };
  const text = [];
  for await (const event of streamPromptTools(reply, source, { tools })) text.push(event);
  assert.deepEqual(text, [{ type: 'text', text: '完成' }]);
  const alias = async function* () { yield { type: 'text', text: '{"type":"function","name":"get_canvas_context","arguments":{}}\\n' }; };
  const aliased = [];
  for await (const event of streamPromptTools(alias, source, { tools })) aliased.push(event);
  assert.equal(aliased[0].calls[0].function.name, 'get_canvas_context');
  let formatAttempts = 0;
  const repair = async function* () { yield { type: 'text', text: ++formatAttempts === 1 ? '先读取画布' : '{"type":"tool_call","name":"get_canvas_context","arguments":{}}' }; };
  for await (const _ of streamPromptTools(repair, source, { tools })) {}
  assert.equal(formatAttempts, 2);
  for (const invalid of ['not JSON', '{"type":"tool_call","name":"submit_generation","arguments":{}}']) {
    await assert.rejects(async () => {
      const stream = async function* () { yield { type: 'text', text: invalid }; };
      for await (const _ of streamPromptTools(stream, source, { tools })) {}
    }, /备用模型/);
  }
});

test('GLM streaming assembles fragmented tool arguments and sends tool results using native protocol', async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (_url, init) => {
    request = JSON.parse(init.body);
    const chunks = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'create_nodes', arguments: '{"nodes":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '[]}' } }] }, finish_reason: 'tool_calls' }] },
    ];
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n');
  };
  try {
    const provider = new GlmProvider({ apiKey: 'test' });
    const events = [];
    const previous = { id: 'old-call', type: 'function', function: { name: 'get_canvas_context', arguments: '{}' } };
    for await (const event of provider.chatStreamEvents([{ role: 'assistant', content: '', tool_calls: [previous] }, { role: 'tool', tool_call_id: 'old-call', content: '{}' }], { model: 'glm-4.6v-flash', tools: [{ type: 'function', function: { name: 'create_nodes', parameters: { type: 'object' } } }] })) events.push(event);
    assert.equal(request.model, 'glm-4.6v-flash');
    assert.equal(request.thinking.type, 'disabled');
    assert.equal(request.messages[1].tool_call_id, 'old-call');
    assert.deepEqual(request.messages[0].tool_calls, [previous]);
    assert.equal(events[0].calls[0].function.arguments, '{"nodes":[]}');
    for await (const _ of provider.chatStreamEvents([], { model: FALLBACK_AGENT_MODEL, tools: [{ type: 'function', function: { name: 'get_canvas_context', parameters: { type: 'object' } } }] })) {}
    assert.equal(request.model, FALLBACK_AGENT_MODEL);
    assert.equal(request.thinking, undefined);
    assert.equal(request.tools, undefined);
  } finally { global.fetch = originalFetch; }
});

test('live GLM creates four storyboard nodes through MCP (opt-in; no media generation)', { skip: process.env.LIVE_AGENT_SMOKE !== '1', timeout: 60000 }, async () => {
  assert(process.env.GLM_API_KEY, 'GLM_API_KEY is required');
  const f = fixture();
  const { GlmProvider: RuntimeGlmProvider } = apiRequire('@reel/llm');
  const model = new RuntimeGlmProvider({ apiKey: process.env.GLM_API_KEY, baseUrl: process.env.GLM_BASE_URL });
  const agent = new CanvasAgentService(f.mcp, model, f.prisma);
  for await (const _ of agent.run(f.scope, randomUUID(), [
    { role: 'system', content: CREATIVE_AGENT_PROMPT },
    { role: 'user', content: '根据选中的故事节点story，创建且只创建四个图片分镜节点，并把故事节点分别连接到它们。只创建节点，不生成媒体。' },
  ], 'glm-4.6v-flash', AbortSignal.timeout(45000))) {}
  assert.equal(f.graph().nodes.length, 5);
  assert.equal(f.graph().edges.length, 4);
  assert.equal(f.runs[0].status, 'completed');
});

test('live image reference creates a real video node and edge through MCP', { skip: process.env.LIVE_AGENT_SMOKE !== '1', timeout: 60000 }, async (t) => {
  const f = fixture();
  const imageId = randomUUID();
  f.graph().nodes.splice(0, 1, { id: imageId, type: 'workflow', position: { x: 0, y: 0 }, data: { kind: 'image', title: '图片', prompt: '小猫', status: 'ready' } });
  f.scope.selectedNodeIds = [imageId];
  const { GlmProvider: RuntimeGlmProvider } = apiRequire('@reel/llm');
  const model = new RuntimeGlmProvider({ apiKey: process.env.GLM_API_KEY, baseUrl: process.env.GLM_BASE_URL });
  const agent = new CanvasAgentService(f.mcp, model, f.prisma);
  const events = [];
  try { for await (const event of agent.run(f.scope, randomUUID(), [
    { role: 'system', content: CREATIVE_AGENT_PROMPT },
    { role: 'user', content: '引用该节点【图片】，创建一个新的视频节点。\n用户引用的当前画布节点：图片节点「图片」' },
  ], FALLBACK_AGENT_MODEL, AbortSignal.timeout(45000))) events.push(event); }
  catch (error) { if (error.cause?.output) t.diagnostic(`Synthetic fixture model output: ${error.cause.output}`); throw error; }
  const video = f.graph().nodes.find(node => node.data.kind === 'video');
  assert(video, '模型回复了文字，但没有创建视频节点');
  assert(f.graph().edges.some(edge => edge.source === imageId && edge.target === video.id), '没有连接引用图片与新视频节点');
  assert.equal(f.graph().nodes.length, 2);
  assert(events.some(event => event.event === 'canvas'));
  assert(!events.filter(event => event.event === 'delta').map(event => event.data.text).join('').includes('old_image_id'));
});

test('live HTTP chat persists image-to-video nodes with real image input, auth, MCP and credits', { skip: process.env.LIVE_AGENT_SMOKE !== '1', timeout: 120000 }, async () => {
  const { PrismaClient } = apiRequire('@reel/db');
  const { Module } = apiRequire('@nestjs/common');
  const { NestFactory } = apiRequire('@nestjs/core');
  const { ZodValidationPipe } = apiRequire('nestjs-zod');
  const { AuthService } = require('../src/modules/auth/auth.service.ts');
  const { AuthGuard } = require('../src/modules/auth/auth.guard.ts');
  const { CreditsService } = require('../src/modules/credits/credits.service.ts');
  const { LlmService } = require('../src/modules/llm/llm.service.ts');
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const repo = path.resolve(__dirname, '../../..');
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  const url = new URL(databaseUrl);
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Only local test databases are allowed');
  const schema = `agent_http_test_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.set('schema', schema);
  const prisma = new PrismaClient({ datasourceUrl: url.toString() });
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-agent-http-'));
  let app;
  try {
    const prismaPackage = createRequire(path.join(repo, 'packages/db/package.json')).resolve('prisma/package.json');
    execFileSync(process.execPath, [path.join(path.dirname(prismaPackage), 'build/index.js'), 'migrate', 'deploy'], { cwd: path.join(repo, 'packages/db'), env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
    const secret = randomUUID();
    const config = { get: key => ({ ...process.env, STORAGE_DIR: storage, SESSION_SECRET: secret, AUTH_COOKIE_NAME: 'agent_http_test', AUTH_SESSION_DAYS: 1, GLM_MODEL: PRIMARY_AGENT_MODEL })[key] };
    const user = await prisma.user.create({ data: { email: `${schema}@invalid.test`, name: 'Agent HTTP fixture' } });
    const imageId = randomUUID();
    const imageDir = path.join(storage, 'users', user.id, 'uploads');
    fs.mkdirSync(imageDir, { recursive: true });
    const imageFile = path.join(imageDir, 'reference.png');
    execFileSync(apiRequire('ffmpeg-static'), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=96x96', '-frames:v', '1', imageFile], { stdio: 'pipe' });
    const imageUrl = `/files/users/${user.id}/uploads/reference.png`;
    const canvas = await prisma.canvas.create({ data: { userId: user.id, name: 'Agent HTTP test', graph: { version: 1, nodes: [{ id: imageId, type: 'workflow', position: { x: 0, y: 0 }, data: { kind: 'image', title: '图片', prompt: '参考图片', url: imageUrl, status: 'ready' } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } } } });
    const credits = new CreditsService(prisma, config);
    const llm = new LlmService(config);
    const agent = new CanvasAgentService(new CanvasMcpService(new CanvasToolsService(prisma)), llm, prisma);
    const chat = new CanvasChatService(prisma, llm, credits, config, agent);
    const auth = new AuthService(prisma, config);
    const conversation = await chat.create(user.id, canvas.id);
    class TestApp {}
    Module({ controllers: [CanvasChatController], providers: [{ provide: CanvasChatService, useValue: chat }, { provide: AuthService, useValue: auth }, AuthGuard] })(TestApp);
    app = await NestFactory.create(TestApp, { logger: false });
    app.useGlobalPipes(new ZodValidationPipe());
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    let cookie;
    auth.setSessionCookie({ cookie: (name, value) => { cookie = `${name}=${value}`; } }, user.id);
    const response = await fetch(`${base}/canvases/${canvas.id}/conversations/${conversation.id}/messages`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ content: `引用该节点 @[${encodeURIComponent('图片')}](node:${imageId})，创建一个新的视频节点`, references: [{ id: imageId, kind: 'image', title: '图片', url: imageUrl }], selectedNodeIds: [imageId] }), signal: AbortSignal.timeout(90000),
    });
    assert.equal(response.status, 200);
    const body = await response.text();
    const persisted = await prisma.canvas.findUniqueOrThrow({ where: { id: canvas.id } });
    const video = persisted.graph.nodes.find(node => node.data.kind === 'video');
    assert(video, `HTTP chat did not create a video node: ${body.slice(-1000)}`);
    assert(persisted.graph.edges.some(edge => edge.source === imageId && edge.target === video.id));
    assert.equal(persisted.graph.nodes.length, 2);
    assert.equal(await prisma.generationTask.count(), 0);
    const history = await chat.get(user.id, canvas.id, conversation.id);
    assert.equal(history.agentRuns[0].status, 'completed');
    assert.equal(history.messages.length, 2);
    assert(!/get_canvas_context|create_nodes|old_image_id/.test(history.messages[1].content));
    assert.match(body, /event: canvas/);
    assert.match(body, /event: done/);
    const balance = await credits.balance(user.id);
    assert.equal(balance.spent, 1);
  } finally {
    await app?.close();
    await prisma.$disconnect();
    assert.equal(path.dirname(path.resolve(storage)), path.resolve(os.tmpdir()));
    assert(path.basename(storage).startsWith('reel-agent-http-'));
    fs.rmSync(storage, { recursive: true, force: true });
    const admin = new PrismaClient({ datasourceUrl: databaseUrl });
    try { assert.match(schema, /^agent_http_test_[a-f0-9]{32}$/); await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await admin.$disconnect(); }
  }
});
