import type { CanvasGraph } from '@reel/contracts';
import { canvasGraphsEqual, canvasSaveBaseline, mergeCanvasGraphs, replayCanvasWrite } from '@reel/contracts/canvas-merge';

type Adapter = {
  local: () => CanvasGraph;
  apply: (graph: CanvasGraph) => void;
  read: (signal: AbortSignal) => Promise<CanvasGraph>;
  write: (input: { graph: CanvasGraph; baseGraph: CanvasGraph; signal: AbortSignal }) => Promise<CanvasGraph>;
  acknowledged?: (graph: CanvasGraph) => void;
};
const snapshot = (graph: CanvasGraph) => JSON.parse(JSON.stringify(graph)) as CanvasGraph;
function abortable<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('画布请求已取消或超时'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { if (signal.aborted) throw new Error('画布请求已取消或超时'); return operation(); }).then(value => {
      signal.removeEventListener('abort', abort); resolve(value);
    }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

/** One owner of acknowledged state and ordering for autosave, explicit saves,
 * background reads and Agent handover. Failed operations never poison the tail. */
export class CanvasPersistence {
  private acknowledged: CanvasGraph;
  private projected: CanvasGraph | null = null;
  private uncertain: { graph: CanvasGraph; baseGraph: CanvasGraph } | null = null;
  private tail: Promise<void> = Promise.resolve();
  private pendingRead?: Promise<void>;
  private readController?: AbortController;
  private agent = false;
  private disposed = false;
  private lifetime = 0;

  constructor(initial: CanvasGraph, private readonly adapter: Adapter, private readonly timeoutMs = 15000) { this.acknowledged = snapshot(initial); }

  activate() { if (this.disposed) { this.disposed = false; this.lifetime++; } }
  dispose() { this.disposed = true; this.lifetime++; this.readController?.abort(); }
  hasChanges(graph = this.adapter.local()) { return !!this.uncertain || !canvasGraphsEqual(graph, this.projected ?? this.acknowledged); }

  private enqueue(operation: () => Promise<void>) {
    const lifetime = this.lifetime;
    const result = this.tail.then(async () => { if (!this.disposed && lifetime === this.lifetime) await operation(); });
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private apply(graph: CanvasGraph) {
    if (!canvasGraphsEqual(this.adapter.local(), graph)) this.adapter.apply(snapshot(graph));
  }

  acceptRemote(graph: CanvasGraph) {
    if (this.disposed) return;
    const local = this.adapter.local();
    const merged = this.uncertain ? replayCanvasWrite(this.uncertain.baseGraph, this.uncertain.graph, local, graph)
      : mergeCanvasGraphs(this.acknowledged, local, graph);
    this.acknowledged = snapshot(graph);
    this.adapter.acknowledged?.(graph);
    this.uncertain = null;
    this.apply(merged);
  }

  private async write(graph: CanvasGraph, baseGraph: CanvasGraph) {
    const lifetime = this.lifetime;
    // Do not send a second uncertain write. Observe the first one's outcome
    // and rebase this command before another mutation can reach the server.
    if (this.uncertain) {
      const remote = await this.fetch();
      if (this.disposed || lifetime !== this.lifetime) return;
      graph = replayCanvasWrite(this.uncertain.baseGraph, this.uncertain.graph, graph, remote);
      baseGraph = remote;
      this.acceptRemote(remote);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const remote = await abortable(controller.signal, () => this.adapter.write({ graph, baseGraph, signal: controller.signal }));
      if (this.disposed || lifetime !== this.lifetime) {
        this.uncertain = { graph, baseGraph };
        return;
      }
      const merged = mergeCanvasGraphs(graph, this.adapter.local(), remote);
      this.acknowledged = snapshot(remote);
      this.adapter.acknowledged?.(remote);
      this.uncertain = null;
      this.apply(merged);
    } catch (error) {
      this.uncertain = { graph, baseGraph };
      throw error;
    } finally { clearTimeout(timer); }
  }

  save() {
    if (this.agent || this.disposed) return Promise.resolve();
    const desired = snapshot(this.adapter.local());
    const baseline = canvasSaveBaseline(this.acknowledged, this.projected, desired);
    this.projected = desired;
    return this.enqueue(async () => { if (!this.agent) await this.write(desired, baseline); }).finally(() => {
      if (this.projected === desired) this.projected = null;
    });
  }

  saveNow() {
    return this.save();
  }

  private async fetch() {
    const controller = new AbortController();
    this.readController = controller;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await abortable(controller.signal, () => this.adapter.read(controller.signal));
    } finally {
      clearTimeout(timer);
      if (this.readController === controller) this.readController = undefined;
    }
  }

  private async read(force = false) {
    if (this.agent && !force) return;
    const lifetime = this.lifetime;
    try {
      const graph = await this.fetch();
      if (!this.disposed && lifetime === this.lifetime && (!this.agent || force)) this.acceptRemote(graph);
    } catch (error) {
      if (!(this.agent && !force || this.disposed || lifetime !== this.lifetime)) throw error;
    }
  }

  sync() {
    if (this.agent || this.disposed) return Promise.resolve();
    if (this.pendingRead) return this.pendingRead;
    const pending = this.enqueue(() => this.read());
    const result = pending.finally(() => { if (this.pendingRead === result) this.pendingRead = undefined; });
    this.pendingRead = result;
    return result;
  }

  async beginAgent() {
    this.agent = true;
    this.readController?.abort();
    await this.tail;
    await this.enqueue(() => this.write(snapshot(this.adapter.local()), this.acknowledged));
  }

  async endAgent(refresh = true) {
    try { if (refresh) await this.enqueue(() => this.read(true)); }
    finally { this.agent = false; }
  }
}
