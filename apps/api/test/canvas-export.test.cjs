const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID: uuid } = require('node:crypto');
const ts = require('typescript');
require('reflect-metadata');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(require('node:fs').readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true } }).outputText, filename);
const { finishRender } = require('../src/modules/render/canvas-export.ts');

test('canvas export materializes independent media and creates exactly one node across retries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-export-'));
  try {
    const id = uuid(), userId = uuid(), assetId = uuid(), canvasId = uuid(), nodeId = uuid();
    const exports = path.join(root, 'users', userId, 'exports');
    await fs.mkdir(exports, { recursive: true });
    const outputPath = path.join(exports, `${id}.mp4`);
    await fs.writeFile(outputPath, 'rendered-video');
    let graph = { version: 1, nodes: [{ id: 'edit', type: 'workflow', position: { x: 0, y: 0 }, data: { kind: 'edit' } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const assets = new Map();
    let state = { id, status: 'rendering', cancelRequested: false };
    const tx = {
      $queryRaw: async () => [{ graph }],
      renderJob: { findUnique: async () => state, update: async ({ data }) => (state = { ...state, ...data }) },
      asset: { upsert: async ({ create }) => { if (!assets.has(create.id)) assets.set(create.id, create); } },
      canvas: { update: async ({ data }) => { graph = data.graph; } },
    };
    const prisma = { ...tx, $transaction: async run => run(tx) };
    const input = { id, userId, snapshot: { canvasExport: { assetId, nodeId, canvasId } }, timeline: { canvasSource: { nodeId: 'edit' }, settings: { fps: 60, width: 1920, height: 1080 }, tracks: [{ clips: [{ start: 0, durationInFrames: 300 }] }] }, outputPath, outputUrl: 'https://example.test/output.mp4', fileName: '成片.mp4' };
    await finishRender(prisma, input);
    await finishRender(prisma, input);
    assert.equal(assets.size, 1);
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.nodes[1].data.assetId, assetId);
    assert.equal(state.status, 'completed');
    assert.equal(assets.get(assetId).durationInFrames, 150);
    await fs.unlink(outputPath);
    assert.equal(await fs.readFile(assets.get(assetId).localPath, 'utf8'), 'rendered-video');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('local export only finalizes the render and does not touch any canvas', async () => {
  let data;
  await finishRender({ renderJob: { update: async input => { data = input.data; } } }, { id: uuid(), userId: uuid(), snapshot: {}, outputPath: '/local.mp4', outputUrl: 'https://example.test/local.mp4', fileName: 'local.mp4', timeline: {} });
  assert.equal(data.status, 'completed');
});


test('enqueue persists canvas destination and verifies ownership before creating a render', async () => {
  const { RenderService } = require('../src/modules/render/render.service.ts');
  const userId = uuid(), canvasId = uuid(), projectId = uuid();
  let owned = true, created;
  const prisma = {
    renderJob: {
      findFirst: async () => null,
      create: async ({ data }) => { created = { ...data, id: uuid(), outputUrl: null, error: null, createdAt: new Date(), updatedAt: new Date() }; return created; },
    },
    project: { findFirst: async () => ({ id: projectId, name: '成片', timeline: { settings: { fps: 30, width: 1920, height: 1080 }, tracks: [] } }) },
    canvas: { findFirst: async ({ where }) => owned && where.userId === userId ? { id: canvasId } : null },
  };
  const service = new RenderService(prisma, { add: async () => {} });
  const result = await service.enqueue(userId, { projectId, canvasId, quality: 'high' });
  assert.equal(result.canvasId, canvasId);
  assert.equal(created.timelineSnapshot.canvasExport.canvasId, canvasId);
  assert.ok(created.timelineSnapshot.canvasExport.nodeId);
  owned = false;
  created = null;
  await assert.rejects(service.enqueue(userId, { projectId, canvasId, quality: 'high' }), /来源画布不存在/);
  assert.equal(created, null);
});
