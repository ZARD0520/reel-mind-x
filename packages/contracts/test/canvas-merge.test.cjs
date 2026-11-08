const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeCanvasGraphs, canvasGraphsEqual, canvasSaveBaseline, UpdateCanvasSchema } = require('../dist/index.js');
const copy = value => JSON.parse(JSON.stringify(value));
const node = (id, data = {}) => ({ id, type: 'workflow', position: { x: 0, y: 0 }, data: { kind: 'image', title: id, status: 'idle', ...data } });
const graph = () => ({ version: 1, nodes: [node('story', { kind: 'text', content: '故事' }), node('picture')], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });

test('queued saves retain delete/undo intent before the preceding response is acknowledged', () => {
  const base = graph(); const deleted = copy(base); deleted.nodes.pop();
  const restored = copy(base);
  const baseline = canvasSaveBaseline(base, deleted, restored);
  const server = mergeCanvasGraphs(base, deleted, base);
  server.nodes.push(node('background-addition'));
  const result = mergeCanvasGraphs(baseline, restored, server);
  assert.deepEqual(result.nodes.map(n => n.id), ['story', 'background-addition', 'picture']);
});

test('failed or uncertain queued additions do not lose subsequent edits or explicit deletion', () => {
  const base = graph(), queued = copy(base); queued.nodes.push(node('new'));
  const edited = copy(queued); edited.nodes.at(-1).data.title = 'later edit';
  const observed = canvasSaveBaseline(base, queued, edited);
  assert.equal(mergeCanvasGraphs(observed, edited, base).nodes.at(-1).data.title, 'later edit', 'first addition was never committed');
  const deleted = copy(base);
  const deleteBaseline = canvasSaveBaseline(base, queued, deleted);
  assert(!mergeCanvasGraphs(deleteBaseline, deleted, queued).nodes.some(n => n.id === 'new'), 'first addition committed but its response was lost');
});

test('stale canvas saves preserve background nodes, connections and completed media while retaining user edits', () => {
  const base = graph(), local = copy(base), remote = copy(base);
  local.nodes[0].data.title = '用户的新标题'; local.nodes[0].position.x = 400; local.viewport.zoom = 1.5;
  local.nodes[1].data.status = 'generating';
  remote.nodes.push(node('new-image', { status: 'generating' }));
  remote.edges.push({ id: 'ref', source: 'story', target: 'new-image' });
  remote.nodes[1].data = { ...remote.nodes[1].data, status: 'ready', assetId: 'asset', url: '/ready.png', generationTaskId: 'task' };
  const merged = mergeCanvasGraphs(base, local, remote);
  assert.equal(merged.nodes.length, 3); assert.equal(merged.edges.length, 1);
  assert.equal(merged.nodes[0].data.title, '用户的新标题'); assert.equal(merged.nodes[0].position.x, 400); assert.equal(merged.viewport.zoom, 1.5);
  assert.equal(merged.nodes[1].data.status, 'ready'); assert.equal(merged.nodes[1].data.url, '/ready.png');
  assert.deepEqual(mergeCanvasGraphs(base, local, merged), merged, 'replaying an autosave does not erase results');
  assert.deepEqual(base, graph(), 'snapshots are immutable');
});

test('observed deletions stay deleted and orphan connections are removed; unobserved additions survive', () => {
  const base = graph(), local = copy(base), remote = copy(base);
  local.nodes = local.nodes.filter(n => n.id !== 'story');
  remote.nodes = remote.nodes.filter(n => n.id !== 'picture');
  remote.nodes.push(node('server-addition'));
  remote.edges.push({ id: 'orphan', source: 'story', target: 'server-addition' });
  local.nodes.push(node('local-addition'));
  const merged = mergeCanvasGraphs(base, local, remote);
  assert.deepEqual(merged.nodes.map(n => n.id), ['server-addition', 'local-addition']); assert.equal(merged.edges.length, 0);
});

test('key ordering and omitted undefined UI fields do not cause autosave loops', () => {
  const base = graph(); const equivalent = copy(base);
  equivalent.nodes[0].data = { title: 'story', content: '故事', status: 'idle', kind: 'text', generationFailureVisible: undefined };
  assert(canvasGraphsEqual(base, equivalent));
  equivalent.nodes[0].data.content = '新的内容'; assert(!canvasGraphsEqual(base, equivalent));
});

test('snapshot merging handles independent field deletion and does not mutate object prototypes', () => {
  const base = graph(), local = copy(base), remote = copy(base);
  base.nodes[0].data.note = local.nodes[0].data.note = remote.nodes[0].data.note = 'remove';
  delete local.nodes[0].data.note; local.nodes[0].data.description = '用户描述';
  remote.nodes[0].data.content = '后台内容';
  local.nodes[0].data.extra = JSON.parse('{"__proto__":{"polluted":true},"local":1}');
  remote.nodes[0].data.extra = { server: 2 };
  const merged = mergeCanvasGraphs(base, local, remote);
  assert.equal(merged.nodes[0].data.note, undefined); assert.equal(merged.nodes[0].data.content, '后台内容');
  assert.equal(merged.nodes[0].data.description, '用户描述'); assert.equal({}.polluted, undefined);
  assert(Object.hasOwn(merged.nodes[0].data.extra, '__proto__'));
  assert(UpdateCanvasSchema.parse({ graph: merged, baseGraph: base }).baseGraph);
});
