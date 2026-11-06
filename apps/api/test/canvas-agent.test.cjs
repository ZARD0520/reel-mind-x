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
  assert.equal(events.filter(event => event.event === 'tool' && event.data.status === 'completed').length, 3);
  assert.equal(events.at(-1).data.text, '已创建四个分镜节点并关联故事。');
  assert.equal(f.runs[0].status, 'completed');
  assert.equal(f.runs[0].events.length, 6);
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
  } finally { global.fetch = originalFetch; }
});

test('live GLM creates four storyboard nodes through MCP (opt-in; no media generation)', { skip: process.env.LIVE_AGENT_SMOKE !== '1', timeout: 60000 }, async () => {
  assert(process.env.GLM_API_KEY, 'GLM_API_KEY is required');
  const f = fixture();
  const model = new GlmProvider({ apiKey: process.env.GLM_API_KEY, baseUrl: process.env.GLM_BASE_URL });
  const agent = new CanvasAgentService(f.mcp, model, f.prisma);
  for await (const _ of agent.run(f.scope, randomUUID(), [
    { role: 'system', content: CREATIVE_AGENT_PROMPT },
    { role: 'user', content: '根据选中的故事节点story，创建且只创建四个图片分镜节点，并把故事节点分别连接到它们。只创建节点，不生成媒体。' },
  ], 'glm-4.6v-flash', AbortSignal.timeout(45000))) {}
  assert.equal(f.graph().nodes.length, 5);
  assert.equal(f.graph().edges.length, 4);
  assert.equal(f.runs[0].status, 'completed');
});
