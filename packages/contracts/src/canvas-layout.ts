type Point = { x: number; y: number };
type LayoutNode = {
  position: Point;
  data: Record<string, unknown>;
  measured?: { width?: number; height?: number };
};

export const CANVAS_NODE_GAP = 160;
const RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '21:9']);

/** Workflow cards have a fixed media height and ratio-dependent width. */
export function canvasNodeSize(data: Record<string, unknown>) {
  if (data.kind === 'image' || data.kind === 'video') {
    const fallback = data.kind === 'video' ? '16:9' : '1:1';
    const ratio = typeof data.aspectRatio === 'string' && RATIOS.has(data.aspectRatio) ? data.aspectRatio : fallback;
    const [width, height] = ratio.split(':').map(Number) as [number, number];
    return { width: Math.round(360 * width / height), height: 400 };
  }
  return { width: 360, height: data.kind === 'edit' ? 520 : data.kind === 'audio' ? 252 : 400 };
}

export function canvasNodeBounds(node: LayoutNode) {
  const size = canvasNodeSize(node.data);
  return { ...node.position, width: node.measured?.width || size.width, height: node.measured?.height || size.height };
}

/** Keep a batch in one column and skip occupied vertical intervals. */
export function layoutVerticalNodes(existing: LayoutNode[], incoming: Record<string, unknown>[], origin?: Point) {
  const occupied = existing.map(canvasNodeBounds);
  const x = origin?.x ?? (occupied.length ? Math.max(...occupied.map(n => n.x + n.width)) + CANVAS_NODE_GAP : 0);
  let y = origin?.y ?? (occupied.length ? Math.min(...occupied.map(n => n.y)) : 0);
  return incoming.map(data => {
    const size = canvasNodeSize(data);
    const column = occupied.filter(n => x < n.x + n.width + CANVAS_NODE_GAP && x + size.width + CANVAS_NODE_GAP > n.x).sort((a, b) => a.y - b.y);
    for (const node of column) {
      if (y < node.y + node.height + CANVAS_NODE_GAP && y + size.height + CANVAS_NODE_GAP > node.y) y = node.y + node.height + CANVAS_NODE_GAP;
    }
    const position = { x, y };
    occupied.push({ ...position, ...size });
    y += size.height + CANVAS_NODE_GAP;
    return position;
  });
}
