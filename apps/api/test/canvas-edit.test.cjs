const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID: uuid } = require('node:crypto');
const ts = require('typescript');
require('reflect-metadata');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, experimentalDecorators: true, emitDecoratorMetadata: true }, fileName: filename }).outputText, filename);
const { ProjectsService } = require('../src/modules/projects/projects.service.ts');

async function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-edit-'));
  try {
    const userId = uuid(), canvasId = uuid();
    const sources = ['video', 'image', 'audio'].map((kind, i) => {
      const localPath = path.join(directory, `${kind}.dat`);
      fs.writeFileSync(localPath, kind);
      return { id: uuid(), userId, kind, status: 'ready', source: 'upload', name: kind, localPath, url: `/files/users/${userId}/uploads/${kind}.dat`, durationInFrames: kind === 'image' ? null : 150 + i * 30, width: kind === 'audio' ? null : 1920, height: kind === 'audio' ? null : 1080, references: [] };
    });
    let graph = { version: 1, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [...sources.map((s, i) => ({ id: `source${i}`, type: 'workflow', position: { x: i * 400, y: 0 }, data: { kind: s.kind, assetId: s.id, status: 'ready' } })), { id: 'edit', type: 'workflow', position: { x: 0, y: 500 }, data: { kind: 'edit', title: '智能剪辑' } }], edges: sources.map((s, i) => ({ id: `edge${i}`, source: `source${i}`, target: 'edit' })) };
    const projects = new Map(), assets = new Map();
    const tx = {
      $queryRaw: async () => [{ graph }],
      canvas: { update: async ({ data }) => { graph = data.graph; } },
      project: {
        count: async () => projects.size,
        findFirst: async ({ where }) => projects.get(where.id) ?? null,
        create: async ({ data }) => { const p = { id: data.id ?? uuid(), ...data, createdAt: new Date(), updatedAt: new Date() }; projects.set(p.id, p); return p; },
        update: async ({ where, data }) => { const p = { ...projects.get(where.id), ...data }; projects.set(p.id, p); return p; },
      },
      asset: {
        findFirst: async ({ where }) => sources.find(asset => asset.id === where.id) ?? null,
        create: async ({ data }) => { assets.set(data.id, data); return data; },
        update: async ({ where, data }) => { const asset = { ...assets.get(where.id), ...data }; assets.set(where.id, asset); return asset; },
        findMany: async ({ where }) => where.id ? sources.filter(s => where.id.in.includes(s.id)) : [...assets.values()].filter(a => a.projectId === where.projectId),
        createMany: async ({ data }) => data.forEach(a => assets.set(a.id, a)),
        deleteMany: async ({ where }) => { for (const [id, asset] of assets) if (asset.projectId === where.projectId && !where.id.notIn.includes(id)) assets.delete(id); },
      },
    };
    const prisma = { ...tx, $transaction: async fn => fn(tx) };
    await run({ service: new ProjectsService(prisma), userId, canvasId, get graph() { return graph; }, sources, projects, assets, prisma });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('creates a multi-material timeline, copies files, reopens idempotently and preserves manual edits', () => fixture(async f => {
  const project = await f.service.openCanvasEdit(f.userId, { canvasId: f.canvasId, nodeId: 'edit' });
  assert.equal(f.assets.size, 3);
  assert.equal(project.timeline.tracks.length, 2);
  assert.equal(project.timeline.tracks[0].clips.length, 2);
  assert.equal(project.timeline.tracks[0].clips[1].start, 150);
  assert.equal(project.timeline.tracks[1].kind, 'audio');
  for (const asset of f.assets.values()) assert.ok(fs.existsSync(asset.localPath));
  project.timeline.tracks[0].clips[0].trimStart = 12;
  await f.service.update(f.userId, project.id, { timeline: project.timeline });
  const reopened = await f.service.openCanvasEdit(f.userId, { canvasId: f.canvasId, nodeId: 'edit' });
  assert.equal(reopened.id, project.id);
  assert.equal(reopened.timeline.tracks[0].clips[0].trimStart, 12);
  assert.equal(f.assets.size, 3);
  f.graph.edges.splice(0, 1);
  const synced = await f.service.openCanvasEdit(f.userId, { canvasId: f.canvasId, nodeId: 'edit' });
  assert.equal(f.assets.size, 3); // Previous outputs stay available to existing render snapshots.
  assert.equal(synced.timeline.canvasSource.assets.length, 2);
  assert.equal(synced.timeline.tracks[0].clips.length, 1);
}));

test('rejects missing or unready dependencies and arbitrary timeline assets', () => fixture(async f => {
  f.graph.nodes[0].data.status = 'generating';
  await assert.rejects(f.service.openCanvasEdit(f.userId, { canvasId: f.canvasId, nodeId: 'edit' }), /尚未就绪/);
  assert.equal(f.projects.size, 0);
  f.graph.nodes[0].data.status = 'ready';
  const project = await f.service.openCanvasEdit(f.userId, { canvasId: f.canvasId, nodeId: 'edit' });
  project.timeline.tracks[0].clips[0].assetId = uuid();
  await assert.rejects(f.service.update(f.userId, project.id, { timeline: project.timeline }), /只能使用节点引用/);
}));

test('restricted asset lists expose only current dependencies, while ordinary projects keep their full library', async () => {
  const { AssetsService } = require('../src/modules/assets/assets.service.ts');
  const allowedId = uuid();
  let timeline = { canvasSource: { assets: [{ assetId: allowedId }] } };
  let query;
  const service = new AssetsService({
    project: { findFirst: async () => ({ timeline }) },
    asset: { findMany: async input => { query = input; return []; } },
  }, {});
  await service.list('user', 'project');
  assert.deepEqual(query.where.id, { in: [allowedId] });
  timeline = {};
  await service.list('user', 'project');
  assert.equal(query.where.id, undefined);
});

test('all project creation paths allow more than three projects per user', () => fixture(async f => {
  // A quota check must not be consulted by ordinary or canvas-based creation.
  f.prisma.project.count = async () => { throw new Error('Removed project quota must not run'); };
  for (let i = 0; i < 5; i++) {
    const project = await f.service.create(f.userId, { name: `剪辑 ${i}` });
    assert.ok(project.id);
  }
  const old = await f.service.createFromCanvasVideo(f.userId, { assetId: f.sources[0].id });
  assert.ok(old.id);
  const smart = await f.service.openCanvasEdit(f.userId, { canvasId: f.canvasId, nodeId: 'edit' });
  assert.ok(smart.id);
}));


test('manual canvas text is imported, refreshed and detached through node dependencies', () => fixture(async f => {
  f.graph.nodes.push({ id: 'text', type: 'workflow', position: { x: 0, y: 0 }, data: { kind: 'text', title: '引用文案', content: '来自画布的文字' } });
  f.graph.edges.splice(0, f.graph.edges.length, { id: 'text-edit', source: 'text', target: 'edit' });
  const project = await f.service.openCanvasEdit(f.userId, { canvasId: f.canvasId, nodeId: 'edit' });
  const mapping = project.timeline.canvasSource.assets[0];
  assert.equal(mapping.sourceNodeId, 'text');
  assert.equal(f.assets.get(mapping.assetId).content, '来自画布的文字');
  f.graph.nodes.find(node => node.id === 'text').data.content = '修改后的画布文字';
  const reopened = await f.service.openCanvasEdit(f.userId, { canvasId: f.canvasId, nodeId: 'edit' });
  assert.equal(reopened.timeline.canvasSource.assets[0].assetId, mapping.assetId);
  assert.equal(f.assets.get(mapping.assetId).content, '修改后的画布文字');
  const { TextClipSchema } = require('@reel/contracts');
  reopened.timeline.tracks.push({ id: uuid(), kind: 'text', muted: false, hidden: false, clips: [], textClips: [TextClipSchema.parse({ id: uuid(), sourceAssetId: mapping.assetId, text: '采用的引用文案', start: 0, durationInFrames: 150 })] });
  await f.service.update(f.userId, reopened.id, { timeline: reopened.timeline });
  f.graph.edges.splice(0, 1, { id: 'video-edit', source: 'source0', target: 'edit' });
  const disconnected = await f.service.openCanvasEdit(f.userId, { canvasId: f.canvasId, nodeId: 'edit' });
  assert.equal(disconnected.timeline.canvasSource.assets.some(asset => asset.sourceNodeId === 'text'), false);
  assert.equal(disconnected.timeline.tracks.find(track => track.kind === 'text').textClips.length, 0);
}));
