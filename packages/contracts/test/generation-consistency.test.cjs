const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeCanvasGraphs } = require('../dist/index.js');
const graph = data => ({ version: 1, nodes: [{ id: 'image', type: 'workflow', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'image', prompt: 'prompt', ...data } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
const snapshot = (task, revision, status = 'completed', time = 1) => ({ generationTaskId: task, generationRequestId: `request-${task}`, generationRevision: revision,
  generationStartedAt: new Date(time * 1000).toISOString(), generationStatus: status, status: status === 'completed' ? 'ready' : 'generating',
  assetId: `${task}-asset-${revision}`, url: status === 'completed' ? `/${task}-${revision}.png` : null, content: `${task}-${revision}`, model: `model-${task}` });

test('a generation result is an atomic versioned snapshot, including asset, status and content', () => {
  const base = graph(snapshot('A', 1, 'generating')), local = graph(snapshot('A', 5)), remote = graph(snapshot('A', 3, 'saving'));
  const result = mergeCanvasGraphs(base, local, remote).nodes[0].data;
  for (const field of ['generationTaskId', 'generationRevision', 'generationStatus', 'status', 'assetId', 'url', 'content', 'model']) assert.equal(result[field], local.nodes[0].data[field], field);
});

test('new task identity cannot be mixed with a late result from its predecessor', () => {
  const base = graph(snapshot('A', 1, 'generating')), local = graph(snapshot('B', 0, 'queued', 2)), remote = graph(snapshot('A', 100));
  const result = mergeCanvasGraphs(base, local, remote).nodes[0].data;
  assert.equal(result.generationTaskId, 'B'); assert.equal(result.status, 'generating');
  assert.equal(result.assetId, 'B-asset-0'); assert.equal(result.generationRevision, 0); assert.equal(result.url, null);
});

test('competing committed tasks use server creation order rather than comparing unrelated task versions', () => {
  const base = graph(snapshot('A', 1)), newer = graph(snapshot('C', 1, 'generating', 3)), older = graph(snapshot('B', 99, 'completed', 2));
  for (const [local, remote] of [[newer, older], [older, newer]]) {
    const result = mergeCanvasGraphs(base, local, remote).nodes[0].data;
    assert.equal(result.generationTaskId, 'C'); assert.equal(result.generationRevision, 1); assert.equal(result.url, null);
  }
});

test('equal creation timestamps use the same task ID tie break as server history', () => {
  const base = graph(snapshot('A', 0)), newer = graph(snapshot('C', 1, 'generating', 3)), older = graph(snapshot('B', 99, 'completed', 3));
  for (const [local, remote] of [[newer, older], [older, newer]]) assert.equal(mergeCanvasGraphs(base, local, remote).nodes[0].data.generationTaskId, 'C');
});

test('manual edits remain independent from a stable completed media snapshot', () => {
  const base = graph(snapshot('A', 5)), local = structuredClone(base), remote = structuredClone(base);
  local.nodes[0].data.title = '用户标题'; local.nodes[0].data.prompt = '用户提示词'; local.nodes[0].data.content = '用户正文'; local.nodes[0].position.x = 99;
  remote.nodes[0].data.generationMessage = '已完成';
  const result = mergeCanvasGraphs(base, local, remote).nodes[0];
  assert.equal(result.data.title, '用户标题'); assert.equal(result.data.prompt, '用户提示词'); assert.equal(result.data.content, '用户正文'); assert.equal(result.position.x, 99);
});

test('all 720 delivery orders preserve task identity, monotonic versions, coherent media and local edits', () => {
  const deliveries = [snapshot('A', 1, 'generating'), snapshot('A', 3), snapshot('A', 4, 'saving'), snapshot('A', 5), snapshot('B', 0, 'queued', 2), snapshot('B', 2, 'completed', 2)];
  const permutations = values => values.length ? values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map(tail => [value, ...tail])) : [[]];
  const base = graph(snapshot('A', 0, 'queued'));
  let count = 0;
  for (const order of permutations(deliveries)) {
    let current = structuredClone(base), expected = base.nodes[0].data;
    current.nodes[0].data.title = '用户修改'; current.nodes[0].position.x = 123;
    for (const delivery of order) {
      const input = graph(delivery), before = JSON.stringify([base, current, input]);
      const merged = mergeCanvasGraphs(base, current, input);
      assert.equal(JSON.stringify([base, current, input]), before, 'merge never mutates an input snapshot');
      if (delivery.generationStartedAt > expected.generationStartedAt || delivery.generationStartedAt === expected.generationStartedAt && delivery.generationRevision > expected.generationRevision) expected = delivery;
      for (const field of ['generationTaskId', 'generationRequestId', 'generationRevision', 'generationStatus', 'status', 'assetId', 'url', 'content', 'model']) assert.equal(merged.nodes[0].data[field], expected[field], field);
      assert.equal(merged.nodes[0].data.title, '用户修改'); assert.equal(merged.nodes[0].position.x, 123);
      assert.deepEqual(mergeCanvasGraphs(base, merged, input), merged, 'duplicate delivery is idempotent');
      current = merged;
    }
    count++;
  }
  assert.equal(count, 720);
});
