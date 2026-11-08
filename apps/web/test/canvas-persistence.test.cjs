const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const localRequire = createRequire(path.resolve(__dirname, '../package.json'));
const ts = localRequire('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const { CanvasPersistence } = require('../src/features/canvas/canvas-persistence.ts');
const { mergeCanvasGraphs } = localRequire('@reel/contracts/canvas-merge');
const clone = value => structuredClone(value);
const make = () => ({ version: 1, nodes: [{ id: 'node', type: 'workflow', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'initial', content: '' } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(overrides = {}) {
  const state = { local: make(), remote: make(), reads: 0, writes: 0, applications: 0 };
  const adapter = {
    local: () => state.local,
    apply: graph => { state.applications++; state.local = clone(graph); },
    read: async () => { state.reads++; return clone(state.remote); },
    write: async ({ graph, baseGraph }) => { state.writes++; state.remote = mergeCanvasGraphs(baseGraph, graph, state.remote); return clone(state.remote); },
    ...overrides,
  };
  return { state, adapter, queue: new CanvasPersistence(clone(state.remote), adapter, 1000) };
}

test('one coordinator serializes autosave, explicit save and reads, coalescing duplicate syncs', async () => {
  const f = fixture(), held = deferred(); let writing = false;
  const write = f.adapter.write;
  f.adapter.write = async input => { writing = true; await held.promise; const result = await write(input); writing = false; return result; };
  f.adapter.read = async () => { assert(!writing); f.state.reads++; return clone(f.state.remote); };
  f.state.local.nodes[0].data.title = 'first'; const first = f.queue.save();
  const read = f.queue.sync(); assert.equal(f.queue.sync(), read);
  f.state.local.nodes[0].data.title = 'second'; const second = f.queue.saveNow();
  held.resolve(); await Promise.all([first, read, second]);
  assert.equal(f.state.remote.nodes[0].data.title, 'second'); assert.equal(f.state.reads, 1); assert.equal(f.state.writes, 2);
});

test('Agent handover aborts an in-flight read, preserves edits and prevents old responses from replacing new state', async () => {
  const f = fixture(); let entered;
  const reading = deferred();
  f.adapter.read = signal => { entered = true; reading.resolve(); return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); };
  const oldRead = f.queue.sync(); await reading.promise; assert(entered);
  f.state.local.nodes[0].data.title = 'before-agent';
  await f.queue.beginAgent(); await oldRead;
  assert.equal(f.state.remote.nodes[0].data.title, 'before-agent');
  const graph = clone(f.state.remote); graph.nodes[0].data.title = 'agent-result'; f.queue.acceptRemote(graph);
  assert.equal(f.state.local.nodes[0].data.title, 'agent-result');
  await f.queue.endAgent(false);
});

test('failure before or after commit does not poison later writes and explicit undo survives an uncertain response', async () => {
  for (const afterCommit of [false, true]) {
    const f = fixture(), write = f.adapter.write; let fail = true;
    f.adapter.write = async input => {
      if (fail) { fail = false; if (afterCommit) await write(input); throw new Error('network failure'); }
      return write(input);
    };
    f.state.local.nodes = [];
    await assert.rejects(f.queue.save(), /network failure/);
    f.state.local = make();
    await f.queue.saveNow();
    assert.equal(f.state.remote.nodes.length, 1, `afterCommit=${afterCommit}`);
  }
});

test('explicit saves participate in the same intent ordering as autosave', async () => {
  const f = fixture(), entered = deferred(), release = deferred(), write = f.adapter.write;
  let first = true;
  f.adapter.write = async input => { if (first) { first = false; entered.resolve(); await release.promise; } return write(input); };
  f.state.local.nodes[0].data.title = 'explicit-save';
  const explicit = f.queue.saveNow(); await entered.promise;
  f.state.local.nodes[0].data.title = 'initial'; const undo = f.queue.save();
  release.resolve(); await Promise.all([explicit, undo]);
  assert.equal(f.state.remote.nodes[0].data.title, 'initial');
});

test('a read after an uncertain write preserves an explicit local undo until it is saved', async () => {
  const f = fixture(), write = f.adapter.write; let first = true;
  f.adapter.write = async input => { const value = await write(input); if (first) { first = false; throw new Error('response lost'); } return value; };
  f.state.local.nodes = []; await assert.rejects(f.queue.save());
  f.state.local = make(); await f.queue.sync();
  assert.equal(f.state.local.nodes.length, 1);
  await f.queue.saveNow(); assert.equal(f.state.remote.nodes.length, 1);
});

test('dirty intent is measured against pending writes and uncertainty, not only the last ACK', async () => {
  const f = fixture(), started = deferred(), held = deferred(), write = f.adapter.write;
  f.adapter.write = async input => { started.resolve(); await held.promise; return write(input); };
  f.state.local.nodes = []; const pending = f.queue.save(); await started.promise;
  assert(!f.queue.hasChanges());
  f.state.local = make(); assert(f.queue.hasChanges(), 'undo equals old ACK but differs from the pending delete');
  const undo = f.queue.save(); held.resolve(); await Promise.all([pending, undo]);
  assert(!f.queue.hasChanges()); assert.equal(f.state.remote.nodes.length, 1);
});

test('failed retries first reconcile their prior outcome and retain delete intent if the read also fails', async () => {
  const f = fixture(), write = f.adapter.write; let writes = 0, failRead = false;
  f.adapter.write = async input => { writes++; if (writes < 3) { if (writes === 1) await write(input); throw new Error('uncertain'); } return write(input); };
  f.adapter.read = async () => { if (failRead) throw new Error('read failed'); return clone(f.state.remote); };
  f.state.local.nodes.push({ ...clone(make().nodes[0]), id: 'new' }); await assert.rejects(f.queue.save());
  f.state.local.nodes = f.state.local.nodes.filter(n => n.id !== 'new');
  failRead = true; await assert.rejects(f.queue.saveNow(), /read failed/); assert.equal(writes, 1);
  failRead = false; await assert.rejects(f.queue.saveNow(), /uncertain/); await f.queue.saveNow();
  assert(!f.state.remote.nodes.some(n => n.id === 'new')); assert(!f.queue.hasChanges());
});

test('disposed and reactivated component lifetimes cannot apply a prior response', async () => {
  const f = fixture(), reading = deferred(), started = deferred();
  f.adapter.read = async () => { started.resolve(); return reading.promise; };
  const old = f.queue.sync(); await started.promise;
  f.queue.dispose(); f.queue.activate(); f.state.local.nodes[0].data.title = 'new-mount';
  reading.resolve(make()); await old;
  assert.equal(f.state.local.nodes[0].data.title, 'new-mount'); assert.equal(f.state.applications, 0);
  await f.queue.saveNow(); assert.equal(f.state.remote.nodes[0].data.title, 'new-mount');
});

test('a write completed across component lifetimes is reconciled before a new undo is persisted', async () => {
  for (const outcome of ['success', 'failure-before-commit', 'failure-after-commit']) {
  const f = fixture(), started = deferred(), release = deferred(), write = f.adapter.write;
  let first = true;
  f.adapter.write = async input => {
    if (first) {
      first = false; started.resolve(); await release.promise;
      if (outcome === 'failure-before-commit') throw new Error(outcome);
      if (outcome === 'failure-after-commit') { await write(input); throw new Error(outcome); }
    }
    return write(input);
  };
  f.state.local.nodes = []; const old = f.queue.save(); await started.promise;
  f.queue.dispose(); f.queue.activate(); f.state.local = make();
  release.resolve(); await old.catch(() => undefined);
  assert.equal(f.state.applications, 0);
  await f.queue.saveNow(); assert.equal(f.state.remote.nodes.length, 1);
  }
});

test('read and write deadlines release the queue even when an adapter ignores cancellation', async () => {
  const f = fixture(); const read = f.adapter.read, write = f.adapter.write;
  const queue = new CanvasPersistence(make(), f.adapter, 5);
  f.adapter.read = async () => new Promise(() => {});
  await assert.rejects(queue.sync(), /超时/);
  f.adapter.read = read; f.adapter.write = async () => new Promise(() => {});
  f.state.local.nodes[0].data.title = 'retry after timeout';
  await assert.rejects(queue.save(), /超时/);
  f.adapter.write = write;
  await queue.saveNow(); assert.equal(f.state.remote.nodes[0].data.title, 'retry after timeout');
});

test('deterministic mixed schedules preserve latest user edits and unrelated server additions', async () => {
  let seed = 0x547019;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let schedule = 0; schedule < 128; schedule++) {
    const f = fixture(), pending = [];
    let expected = 'initial';
    for (let step = 0; step < 24; step++) {
      const action = next() % 4;
      if (action < 2) { expected = `${schedule}:${step}`; f.state.local.nodes[0].data.title = expected; pending.push(f.queue.save()); }
      else if (action === 2) { const remoteNode = { ...clone(make().nodes[0]), id: `server-${step}` }; f.state.remote.nodes.push(remoteNode); pending.push(f.queue.sync()); }
      else await Promise.resolve();
    }
    await Promise.all(pending); await f.queue.saveNow();
    assert.equal(f.state.local.nodes[0].data.title, expected); assert.equal(f.state.remote.nodes[0].data.title, expected);
    assert(f.state.remote.nodes.filter(node => node.id.startsWith('server-')).every(node => f.state.local.nodes.some(local => local.id === node.id)));
  }
});
