import type { CanvasGraph } from './index';
import { mergeGenerationSnapshot } from './generation-snapshot';

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter(key => left[key] !== undefined);
  return keys.length === Object.keys(right).filter(key => right[key] !== undefined).length && keys.every(key => same(left[key], right[key]));
}
export const canvasGraphsEqual = (a: CanvasGraph, b: CanvasGraph) => same(a, b);

/** Reconcile a write whose response was lost: reapply the attempted intent,
 * then the edits made after it, against an authoritative server observation. */
export function replayCanvasWrite(base: CanvasGraph, attempted: CanvasGraph, local: CanvasGraph, remote: CanvasGraph) {
  return mergeCanvasGraphs(attempted, local, mergeCanvasGraphs(base, attempted, remote));
}

/** A pending local write supplies ordering intent, but its additions are not
 * acknowledged yet. Retain those additions in the baseline only when the next
 * edit deletes them, so a failed/uncertain response cannot lose either intent. */
export function canvasSaveBaseline(acknowledged: CanvasGraph, queued: CanvasGraph | null, desired: CanvasGraph): CanvasGraph {
  if (!queued) return acknowledged;
  const observedNodes = new Set(acknowledged.nodes.map(node => node.id)), desiredNodes = new Set(desired.nodes.map(node => node.id));
  const observedEdges = new Set(acknowledged.edges.map(edge => edge.id)), desiredEdges = new Set(desired.edges.map(edge => edge.id));
  return { ...queued,
    nodes: queued.nodes.filter(node => observedNodes.has(node.id) || !desiredNodes.has(node.id)),
    edges: queued.edges.filter(edge => observedEdges.has(edge.id) || !desiredEdges.has(edge.id)),
  };
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const generationField = (key: string) => key.startsWith('generation') || ['status', 'assetId', 'url', 'error', 'model'].includes(key);

/** Apply local edits relative to the last observed graph, retaining concurrent
 * server additions and generation results. This is an optimistic merge of JSON
 * snapshots, not a general collaborative document/CRDT implementation. */
export function mergeCanvasGraphs(base: CanvasGraph, local: CanvasGraph, remote: CanvasGraph): CanvasGraph {
  const merge = (before: unknown, edited: unknown, current: unknown, key = ''): unknown => {
    if (same(edited, before)) return current;
    if (same(current, before)) return edited;
    if (generationField(key)) return current;
    if (record(edited) && record(current) && (record(before) || before === undefined)) {
      const previous = record(before) ? before : {};
      return Object.fromEntries([...new Set([...Object.keys(previous), ...Object.keys(edited), ...Object.keys(current)])]
        .map(field => [field, merge(previous[field], edited[field], current[field], field)]));
    }
    return edited;
  };
  const collection = <T extends { id: string }>(previous: T[], edited: T[], current: T[], combine?: (base: T | undefined, local: T, remote: T, merged: T) => T): T[] => {
    const before = new Map(previous.map(item => [item.id, item]));
    const after = new Map(edited.map(item => [item.id, item]));
    const server = new Map(current.map(item => [item.id, item]));
    return [...new Set([...current.map(item => item.id), ...edited.map(item => item.id)])].flatMap(id => {
      const b = before.get(id), l = after.get(id), r = server.get(id);
      // An observed node/edge deleted on either side stays deleted. A server
      // addition absent from the old snapshot is never mistaken for a deletion.
      if (b && (!l || !r)) return [];
      if (!l) return r ? [r] : [];
      if (!r) return [l];
      const result = merge(b, l, r) as T;
      return [combine ? combine(b, l, r, result) : result];
    });
  };
  const nodes = collection(base.nodes, local.nodes, remote.nodes, (before, local, remote, result) => ({ ...result,
    data: mergeGenerationSnapshot(before?.data ?? {}, local.data, remote.data, result.data),
  }));
  const ids = new Set(nodes.map(node => node.id));
  return { ...remote, nodes,
    edges: collection(base.edges, local.edges, remote.edges).filter(edge => ids.has(edge.source) && ids.has(edge.target)),
    viewport: merge(base.viewport, local.viewport, remote.viewport) as CanvasGraph['viewport'],
  };
}
