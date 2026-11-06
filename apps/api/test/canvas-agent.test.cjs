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

test('rename tool changes only the requested node title and preserves content and graph size', async () => {
  const f = fixture();
  const before = structuredClone(f.graph());
  const context = await f.tools.execute(f.scope, 'get_canvas_context', {});
  await f.tools.execute(f.scope, 'rename_node', { expectedRevision: context.revision, nodeId: 'story', title: '测试agent' });
  assert.equal(f.graph().nodes[0].data.title, '测试agent');
  assert.equal(f.graph().nodes[0].data.content, before.nodes[0].data.content);
  assert.equal(f.graph().nodes.length, before.nodes.length);
  assert.deepEqual(f.graph().edges, before.edges);
});

test('prompt tool protocol rejects missing rename arguments before emitting a call, with bounded repair', async () => {
  const tools = [{ type: 'function', function: { name: 'rename_node', parameters: { type: 'object', required: ['expectedRevision', 'nodeId', 'title'] } } }];
  const args = { expectedRevision: new Date().toISOString(), nodeId: 'story', title: '测试agent' };
  let attempts = 0;
  const events = [];
  for await (const event of streamPromptTools(async function* () {
    yield { type: 'text', text: JSON.stringify({ type: 'tool_call', name: 'rename_node', arguments: attempts++ ? args : {} }) };
  }, [{ role: 'user', content: '重命名' }], { model: PRIMARY_AGENT_MODEL, tools })) events.push(event);
  assert.equal(attempts, 2);
  assert.equal(events.length, 1);
  assert.deepEqual(JSON.parse(events[0].calls[0].function.arguments), args);
  attempts = 0;
  await assert.rejects(async () => {
    for await (const _ of streamPromptTools(async function* () {
      attempts++;
      yield { type: 'text', text: '{"type":"tool_call","name":"rename_node","arguments":{}}' };
    }, [], { model: PRIMARY_AGENT_MODEL, tools })) assert.fail('invalid call must never be emitted');
  }, /有效的操作结果/);
  assert.equal(attempts, 2);
});

test('assistant final text omits internal thinking including an orphan closing tag', () => {
  const { finalAnswerText } = apiRequire('@reel/llm');
  assert.equal(finalAnswerText('<think>旧任务思考</think>新问题的回答'), '新问题的回答');
  assert.equal(finalAnswerText('旧任务思考\n</think>\n新问题的回答'), '新问题的回答');
  assert.equal(finalAnswerText('<think>未完成思考'), '');
});

test('real MCP discovery, scoped reads, validation, prompt updates, connections and stale revision rejection', async () => {
  const f = fixture();
  const session = await f.mcp.connect(f.scope);
  try {
    const names = (await session.client.listTools()).tools.map(tool => tool.name);
    assert.deepEqual(names.sort(), ['connect_nodes', 'create_nodes', 'get_canvas_context', 'rename_node', 'update_node_prompt']);
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
    assert.equal((await client.listTools()).tools.length, 5);
    const context = await client.callTool({ name: 'get_canvas_context', arguments: {} });
    assert.equal(context.structuredContent.nodes[0].id, 'story');
    const response = await fetch(url, { method: 'POST', headers: { origin: 'https://untrusted.test', 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(response.status, 403);
  } finally { await client.close(); await new Promise(resolve => server.close(resolve)); }
});

test('creating nodes with invalid references rolls back the entire MCP edit', async () => {
  const f = fixture();
  const context = await f.tools.execute(f.scope, 'get_canvas_context', {});
  await assert.rejects(f.tools.execute(f.scope, 'create_nodes', { expectedRevision: context.revision, nodes: [{ kind: 'video', title: '视频', referenceNodeIds: ['missing'] }] }), /不存在/);
  assert.equal(f.graph().nodes.length, 1);
  assert.equal(f.graph().edges.length, 0);
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
    assert.equal(options.temperature, 0);
    assert.deepEqual(messages[1].images, images);
    assert(messages[1].content.includes('get_canvas_context'));
    assert(messages[1].content.includes('当前唯一待处理的用户请求'));
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

test('thinking fallback retries truncated output once with a bounded budget before emitting any tool', async () => {
  const previous = global.fetch;
  const tools = [{ type: 'function', function: { name: 'get_canvas_context', parameters: { type: 'object' } } }];
  const candidate = '{"type":"tool_call","name":"get_canvas_context","arguments":{}}';
  const budgets = [];
  let alwaysTruncated = false;
  const abort = new AbortController();
  let cancel = false;
  global.fetch = async (_url, init) => {
    budgets.push(JSON.parse(init.body).max_tokens);
    if (cancel) abort.abort();
    const truncated = alwaysTruncated || budgets.length === 1;
    return new Response([
      { choices: [{ delta: { reasoning_content: 'thinking' } }] },
      // Even syntactically complete JSON must be discarded when finish_reason=length.
      { choices: [{ delta: { content: candidate }, finish_reason: truncated ? 'length' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 16384, total_tokens: 16484 } },
    ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n');
  };
  try {
    const provider = new GlmProvider({ apiKey: 'test' });
    const run = async (options = {}) => {
      const events = [];
      for await (const event of provider.chatStreamEvents([{ role: 'user', content: '读取画布' }], { model: FALLBACK_AGENT_MODEL, tools, maxTokens: 4096, ...options })) events.push(event);
      return events;
    };
    const events = await run();
    assert.deepEqual(budgets, [16384, 32768]);
    assert.equal(events.length, 1);
    assert.equal(events[0].calls[0].function.name, 'get_canvas_context');
    budgets.length = 0;
    alwaysTruncated = true;
    await assert.rejects(run, error => {
      assert.equal(error.cause.code, 'OUTPUT_TOKEN_LIMIT');
      assert.equal(error.cause.model, FALLBACK_AGENT_MODEL);
      assert.equal(error.cause.maxTokens, 32768);
      assert.equal(error.cause.reasoningCharacters, 8);
      assert.equal(error.cause.contentCharacters, candidate.length);
      assert.equal(error.cause.usage.prompt_tokens, 100);
      return true;
    });
    assert.deepEqual(budgets, [16384, 32768]);
    budgets.length = 0;
    await assert.rejects(() => run({ maxTokens: 99999 }), /长度限制/);
    assert.deepEqual(budgets, [32768]);
    budgets.length = 0;
    cancel = true;
    await assert.rejects(() => run({ signal: abort.signal }), /abort/i);
    assert.deepEqual(budgets, [16384]);
  } finally { global.fetch = previous; }
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

test('empty streaming tool scaffolding does not invalidate a final reply or execute an empty tool', async () => {
  const previous = global.fetch;
  try {
    global.fetch = async () => new Response([
      { choices: [{ delta: { content: '已完成', tool_calls: [{ index: 0, id: 'empty', function: { name: '', arguments: '' } }] }, finish_reason: 'stop' }] },
    ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n');
    const events = [];
    for await (const event of new GlmProvider({ apiKey: 'test' }).chatStreamEvents([], { model: PRIMARY_AGENT_MODEL })) events.push(event);
    assert.deepEqual(events, [{ type: 'text', text: '已完成' }]);
    global.fetch = async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } }] })}\n\ndata: [DONE]\n\n`);
    await assert.rejects(async () => { for await (const _ of new GlmProvider({ apiKey: 'test' }).chatStreamEvents([], { model: PRIMARY_AGENT_MODEL })) {} }, /工具调用不完整/);
  } finally { global.fetch = previous; }
});

test('malformed native calls are repaired before emission and share a hard HTTP request budget', async () => {
  const previous = global.fetch;
  const tools = [{ type: 'function', function: { name: 'submit_plan', parameters: { type: 'object', required: ['goal'] } } }];
  let requests = 0;
  global.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests++;
    const delta = body.tools ? { tool_calls: [{ index: 0, function: { arguments: '{}' } }] }
      : { content: '{"type":"tool_call","name":"submit_plan","arguments":{"goal":"重命名"}}' };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  };
  try {
    const provider = new GlmProvider({ apiKey: 'test' });
    const events = [];
    for await (const e of provider.chatStreamEvents([{ role: 'user', content: '规划重命名' }], { model: PRIMARY_AGENT_MODEL, tools, maxTokens: 4096, requestBudget: { remainingRequests: 2, remainingOutputTokens: 8192 } })) events.push(e);
    assert.equal(requests, 2);
    assert.equal(events.length, 1);
    assert.equal(events[0].calls[0].function.name, 'submit_plan');
    requests = 0;
    await assert.rejects(async () => {
      for await (const _ of provider.chatStreamEvents([], { model: PRIMARY_AGENT_MODEL, tools, maxTokens: 4096, requestBudget: { remainingRequests: 1, remainingOutputTokens: 4096 } })) assert.fail('invalid call must not escape');
    }, e => e.cause.code === 'REQUEST_BUDGET');
    assert.equal(requests, 1);
  } finally { global.fetch = previous; }
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
    const modelFailures = [];
    const streamModel = llm.chatStreamEvents.bind(llm);
    llm.chatStreamEvents = async function* (...args) {
      let candidate = '';
      try { for await (const event of streamModel(...args)) { if (event.type === 'text') candidate += event.text; yield event; } modelFailures.push({ candidate: candidate.slice(-3000) }); }
      catch (error) { modelFailures.push({ message: error.message, status: error.status, cause: error.cause }); throw error; }
    };
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
    const actualRun = await prisma.canvasAgentRun.findFirst({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' } });
    const diagnostic = JSON.stringify({ error: actualRun?.error, events: actualRun?.events, modelFailures });
    assert(video, `HTTP chat did not create a video node: ${diagnostic}`);
    assert(persisted.graph.edges.some(edge => edge.source === imageId && edge.target === video.id));
    assert.equal(persisted.graph.nodes.length, 2, diagnostic);
    assert.equal(await prisma.generationTask.count(), 0);
    const history = await chat.get(user.id, canvas.id, conversation.id);
    assert.equal(history.agentRuns[0].status, 'completed', diagnostic);
    assert.equal(history.messages.length, 2);
    assert(!/get_canvas_context|create_nodes|old_image_id/.test(history.messages[1].content));
    assert.match(body, /event: canvas/);
    assert.match(body, /event: done/);
    const balance = await credits.balance(user.id);
    assert.equal(balance.spent, 1);
    // Reproduce the user's sequence: an old creation request failed, then a new rename request arrives.
    await chat.saveErrorTurn(user.id, canvas.id, conversation.id, '根据图片再创建三个图片节点', [], new Error('fixture previous failure'));
    const rename = await fetch(`${base}/canvases/${canvas.id}/conversations/${conversation.id}/messages`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ content: `本轮只把节点 @[视频](node:${video.id}) 的名称更改为测试agent，不要创建其他节点`, references: [{ id: video.id, kind: 'video', title: video.data.title }], selectedNodeIds: [imageId] }), signal: AbortSignal.timeout(90000),
    });
    const renameBody = await rename.text();
    const renamed = await prisma.canvas.findUniqueOrThrow({ where: { id: canvas.id } });
    const renameRun = await prisma.canvasAgentRun.findFirst({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' } });
    assert.equal(renamed.graph.nodes.find(node => node.id === video.id).data.title, '测试agent', JSON.stringify({ error: renameRun?.error, events: renameRun?.events }));
    assert.equal(renamed.graph.nodes.length, 2, 'New turn must not resume old creation request');
    assert.equal(renameRun.status, 'completed');
    assert(renameRun.events.some(event => event.name === 'rename_node' && event.status === 'completed'));
    assert(!renameRun.events.some(event => event.name === 'create_nodes'));
    assert.match(renameBody, /event: done/);
    const finalHistory = await chat.get(user.id, canvas.id, conversation.id);
    assert.equal(finalHistory.messages.length, 6);
    assert(!finalHistory.messages.at(-1).content.includes('</think>'));

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
