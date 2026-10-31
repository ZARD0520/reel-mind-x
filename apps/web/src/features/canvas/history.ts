import type { Edge, Node } from '@xyflow/react';

type Graph<N extends Node> = { nodes: N[]; edges: Edge[] };
type Edit = { id: string; before: unknown; after: unknown; key?: string };
type Entry = { nodes: Edit[]; edges: Edit[]; group: string; time: number };
const editable = ['title', 'content', 'prompt', 'model', 'referenceNodeIds', 'generationCount', 'aspectRatio', 'generationSize', 'generationQuality', 'videoFps', 'videoDuration', 'videoWithAudio'];
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const edgeValue = ({ selected: _selected, ...edge }: Edge) => edge;

/** Local edit history. Field patches preserve asynchronous generation/upload results. */
export class CanvasHistory<N extends Node> {
  past: Entry[] = [];
  future: Entry[] = [];
  private previous: Graph<N>;
  private latestNodes = new Map<string, N>();
  private boundary = 0;

  constructor(graph: Graph<N>) {
    this.previous = graph;
    graph.nodes.forEach(node => this.latestNodes.set(node.id, node));
  }

  breakGroup() { this.boundary++; }

  observe(graph: Graph<N>, time = Date.now()) {
    const before = this.previous;
    this.previous = graph;
    graph.nodes.forEach(node => this.latestNodes.set(node.id, node));
    const oldNodes = new Map(before.nodes.map(node => [node.id, node]));
    const newNodes = new Map(graph.nodes.map(node => [node.id, node]));
    const nodes: Edit[] = [];
    // Batch outputs belong to a running task rather than a user editing action.
    const generated = new Set(graph.nodes.filter(node => !oldNodes.has(node.id) && node.data.generationBatchTaskId && before.nodes.some(parent => parent.data.generationTaskId === node.data.generationBatchTaskId && parent.data.generationBatchResultsTaskId !== node.data.generationBatchTaskId)).map(node => node.id));
    for (const id of new Set([...oldNodes.keys(), ...newNodes.keys()])) {
      const old = oldNodes.get(id), next = newNodes.get(id);
      if (!old || !next) {
        if (!generated.has(id)) nodes.push({ id, before: old, after: next });
        continue;
      }
      if (!equal(old.position, next.position)) nodes.push({ id, key: 'position', before: old.position, after: next.position });
      const runtimeChanged = ['generationRequestId', 'generationTaskId', 'generationAppliedTaskId', 'assetId', 'uploadState'].some(key => !equal(old.data[key], next.data[key]));
      for (const key of editable) {
        if (runtimeChanged && ['title', 'content', 'model', 'aspectRatio'].includes(key)) continue;
        if (key === 'content' && (old.data.status === 'generating' || next.data.status === 'generating')) continue;
        if (!equal(old.data[key], next.data[key])) nodes.push({ id, key: `data.${key}`, before: old.data[key], after: next.data[key] });
      }
    }
    const oldEdges = new Map(before.edges.map(edge => [edge.id, edgeValue(edge)]));
    const newEdges = new Map(graph.edges.map(edge => [edge.id, edgeValue(edge)]));
    const edges: Edit[] = [];
    for (const id of new Set([...oldEdges.keys(), ...newEdges.keys()])) {
      const old = oldEdges.get(id), next = newEdges.get(id);
      if (next && generated.has(next.target)) continue;
      if (!equal(old, next)) edges.push({ id, before: old, after: next });
    }
    if (!nodes.length && !edges.length) return false;
    // Only repeated changes to the same fields merge. Structural edits stay distinct.
    const mergeable = !edges.length && nodes.every(edit => !!edit.key);
    const group = `${this.boundary}:${nodes.map(edit => `${edit.id}:${edit.key}`).sort().join('|')}`;
    const last = this.past.at(-1);
    const dragging = graph.nodes.some(node => node.dragging);
    if (mergeable && last?.group === group && (dragging || time - last.time < 600)) {
      nodes.forEach(edit => { last.nodes.find(previous => previous.id === edit.id && previous.key === edit.key)!.after = edit.after; });
      last.time = time;
    } else {
      this.past.push({ nodes, edges, group: mergeable ? group : '', time });
      if (this.past.length > 100) this.past.shift();
    }
    this.future = [];
    return true;
  }

  travel(graph: Graph<N>, direction: 'undo' | 'redo'): Graph<N> | null {
    this.observe(graph);
    const source = direction === 'undo' ? this.past : this.future;
    const target = direction === 'undo' ? this.future : this.past;
    const entry = source.pop();
    if (!entry) return null;
    target.push(entry);
    this.breakGroup();
    const side = direction === 'undo' ? 'before' : 'after';
    let nodes = graph.nodes;
    for (const edit of entry.nodes) {
      const value = edit[side];
      if (!edit.key) {
        nodes = nodes.filter(node => node.id !== edit.id);
        if (value) {
          const node = this.latestNodes.get(edit.id) ?? value as N;
          nodes = [...nodes, { ...node, selected: false, dragging: false }];
        }
      } else {
        nodes = nodes.map(node => {
          if (node.id !== edit.id) return node;
          const current = edit.key === 'position' ? node.position : node.data[edit.key!.slice(5)];
          // A later server result owns this field; an older edit must not overwrite it.
          if (!equal(current, edit[direction === 'undo' ? 'after' : 'before'])) return node;
          return edit.key === 'position'
            ? { ...node, position: value as N['position'], dragging: false }
            : { ...node, data: { ...node.data, [edit.key!.slice(5)]: value } };
        });
      }
    }
    let edges = graph.edges;
    for (const edit of entry.edges) {
      edges = edges.filter(edge => edge.id !== edit.id);
      if (edit[side]) edges = [...edges, { ...edit[side] as Edge, selected: false }];
    }
    const ids = new Set(nodes.map(node => node.id));
    edges = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
    this.previous = { nodes, edges };
    return this.previous;
  }
}
