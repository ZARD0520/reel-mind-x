const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
const filename = require('node:path').resolve(__dirname, '../src/features/canvas/history.ts');
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { CanvasHistory } = compiled.exports;
const node = (id, data = {}) => ({ id, type: 'workflow', position: { x: 0, y: 0 }, data: { kind: 'text', title: id, content: '', ...data } });
const graph = (nodes = [], edges = []) => ({ nodes, edges });

test('add, delete with incident edges, redo, and new branch', () => {
  let current = graph([node('a'), node('b')], [{ id: 'ab', source: 'a', target: 'b' }]);
  const history = new CanvasHistory(current);
  history.observe(graph([node('a')]));
  current = history.travel(graph([node('a')]), 'undo');
  assert.equal(current.nodes.length, 2);
  assert.equal(current.edges.length, 1);
  current = history.travel(current, 'redo');
  assert.equal(current.nodes.length, 1);
  current = history.travel(current, 'undo');
  history.observe(graph([...current.nodes, node('c')], current.edges));
  assert.equal(history.future.length, 0);
});

test('selection and measurement changes do not consume history', () => {
  const history = new CanvasHistory(graph([node('a')]));
  history.observe(graph([{ ...node('a'), selected: true, measured: { width: 400, height: 300 } }]));
  assert.equal(history.past.length, 0);
});

test('one long drag undoes in one step, separate gestures stay separate', () => {
  let current = graph([node('a')]);
  const history = new CanvasHistory(current);
  for (let x = 1; x <= 10; x++) {
    current = graph([{ ...node('a'), dragging: true, position: { x, y: 0 } }]);
    history.observe(current, x * 1000);
  }
  assert.equal(history.past.length, 1);
  current = history.travel(current, 'undo');
  assert.equal(current.nodes[0].position.x, 0);
  current = history.travel(current, 'redo');
  assert.equal(current.nodes[0].position.x, 10);
  history.breakGroup();
  history.observe(graph([{ ...current.nodes[0], position: { x: 20, y: 0 } }]));
  assert.equal(history.past.length, 2);
});

test('runtime completion is not undoable and does not erase redo or generated media', () => {
  let current = graph([node('a')]);
  const history = new CanvasHistory(current);
  current = graph([{ ...node('a'), position: { x: 24, y: 0 } }]);
  history.observe(current);
  current = history.travel(current, 'undo');
  current = graph([{ ...current.nodes[0], data: { ...current.nodes[0].data, generationTaskId: 'task', generationAppliedTaskId: 'task', assetId: 'asset', content: 'generated', status: 'ready', url: '/output' } }]);
  history.observe(current);
  assert.equal(history.past.length, 0);
  assert.equal(history.future.length, 1);
  current = history.travel(current, 'redo');
  assert.equal(current.nodes[0].position.x, 24);
  assert.equal(current.nodes[0].data.content, 'generated');
  assert.equal(current.nodes[0].data.url, '/output');
});

test('typing groups and undo preserves other runtime fields', () => {
  const history = new CanvasHistory(graph([node('a')]));
  history.observe(graph([node('a', { prompt: 'h' })]), 1000);
  let current = graph([node('a', { prompt: 'hi', status: 'ready', url: '/result' })]);
  history.observe(current, 1200);
  assert.equal(history.past.length, 1);
  current = history.travel(current, 'undo');
  assert.equal(current.nodes[0].data.prompt, undefined);
  assert.equal(current.nodes[0].data.url, '/result');
});

test('batch task outputs are ignored but copying completed output is undoable', () => {
  const parent = node('a', { generationTaskId: 'task', status: 'generating' });
  const history = new CanvasHistory(graph([parent]));
  const completed = node('a', { generationTaskId: 'task', generationBatchResultsTaskId: 'task', status: 'ready' });
  const output = node('out', { generationBatchTaskId: 'task', assetId: 'out' });
  let current = graph([completed, output], [{ id: 'auto', source: 'a', target: 'out' }]);
  history.observe(current);
  assert.equal(history.past.length, 0);
  current = graph([...current.nodes, { ...output, id: 'copy' }], current.edges);
  history.observe(current);
  current = history.travel(current, 'undo');
  assert.deepEqual(current.nodes.map(n => n.id), ['a', 'out']);
});

test('history is bounded to 100 edits', () => {
  const history = new CanvasHistory(graph());
  for (let i = 1; i <= 110; i++) history.observe(graph(Array.from({ length: i }, (_, j) => node(String(j)))));
  assert.equal(history.past.length, 100);
});

test('older content edits never overwrite a newer generated result in either direction', () => {
  const history = new CanvasHistory(graph([node('a', { content: 'original' })]));
  history.observe(graph([node('a', { content: 'manual edit' })]));
  let current = graph([node('a', { content: 'generated result', assetId: 'result', generationAppliedTaskId: 'task' })]);
  history.observe(current);
  current = history.travel(current, 'undo');
  assert.equal(current.nodes[0].data.content, 'generated result');
  current = history.travel(current, 'redo');
  assert.equal(current.nodes[0].data.content, 'generated result');
});
