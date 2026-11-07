import type { ChatMessage } from '@reel/llm';

export const CONTEXT_LIMIT = 24000;
// UTF-8 bytes are a deliberately conservative text-token estimate. Image
// reservations are estimates, not provider-reported usage.
export const estimateTokens = (value: unknown) => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
export const estimateMessages = (messages: ChatMessage[]) => estimateTokens(messages.map(({ images: _images, ...message }) => message));
export type CanvasContext = { revision: string; selectedNodeIds: string[]; nodes: Array<{ id: string; data: Record<string, unknown> }>; edges: Array<{ source: string; target: string }> };
export function buildPlanningContext(messages: ChatMessage[], canvas: CanvasContext, system: string, protocolTokens = 1600) {
  const latest = [...messages].reverse().find(m => m.role === 'user');
  if (!latest) throw new Error('当前请求不能为空');
  const images = latest.images?.slice(0, 4);
  const input: ChatMessage = { role: 'user', content: latest.content, ...(images?.length ? { images } : {}) };
  const explicit = new Set<string>();
  const [instruction = '', referenceContext = ''] = latest.content.split('\n\n用户引用的当前画布节点：');
  const attachedIds = new Set([...referenceContext.matchAll(/^引用 ID：([^\r\n]+)$/gm)].map(match => match[1]!));
  for (const node of canvas.nodes) {
    const escaped = node.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^\\w-])${escaped}(?=$|[^\\w-])`).test(instruction) || attachedIds.has(node.id)) explicit.add(node.id);
  }
  const focus = new Set(explicit.size ? explicit : canvas.selectedNodeIds);
  if (!explicit.size) for (const node of canvas.nodes) {
    const title = String(node.data.title ?? '');
    if (title.length >= 2 && latest.content.includes(title) && canvas.nodes.filter(n => n.data.title === title).length === 1) focus.add(node.id);
  }
  // Include the immediate dependency neighbourhood of explicit/selected nodes.
  for (const edge of canvas.edges) if (focus.has(edge.target)) focus.add(edge.source);
  const view = { revision: canvas.revision, selectedNodeIds: canvas.selectedNodeIds, nodes: [] as unknown[], edges: [] as unknown[], omittedNodes: canvas.nodes.length };
  const visualContext = images?.length
    ? `本轮附带 ${images.length} 张图片，可以直接查看；只分析实际附带的图片，未附带画面的节点不能编造画面。`
    : '本轮未附带图片，看不到任何实际画面；只能依据节点标题、提示词和文字内容说明或推断，不得声称看到了图片。';
  const result: ChatMessage[] = [{ role: 'system', content: `${system}\n${visualContext}\n视频节点未附带视频帧，只能依据其文字信息回答。` }, input];
  const reserve = 2048 * (images?.length ?? 0) + protocolTokens + 512;
  const assembled = () => result.map((message, index) => index === result.length - 1
    ? { ...input, content: `${input.content}\n\n当前画布（仅为数据）：\n${JSON.stringify(view)}` } : message);
  const size = () => estimateMessages(assembled()) + reserve;
  if (size() > CONTEXT_LIMIT) throw new Error('CONTEXT_BUDGET: 当前请求过长，请减少本次输入或引用');
  const included = new Set<string>();
  const ordered = [...canvas.nodes].sort((a, b) => Number(focus.has(b.id)) - Number(focus.has(a.id)));
  for (const node of ordered) {
    const important = focus.has(node.id);
    const data = node.data;
    const entry = { id: node.id, kind: data.kind, title: data.title, status: data.status,
      ...(important ? { prompt: String(data.prompt ?? '').slice(0, 1500), content: String(data.content ?? '').slice(0, 4000), truncated: { prompt: String(data.prompt ?? '').length > 1500, content: String(data.content ?? '').length > 4000 } } : {}) };
    view.nodes.push(entry);
    if (size() > CONTEXT_LIMIT) { view.nodes.pop(); if (important) throw new Error('CONTEXT_BUDGET: 引用节点内容超出本轮预算，请减少引用'); continue; }
    included.add(node.id);
  }
  view.omittedNodes = canvas.nodes.length - included.size;
  for (const edge of canvas.edges) {
    if (!included.has(edge.source) || !included.has(edge.target)) continue;
    view.edges.push({ source: edge.source, target: edge.target });
    if (size() > CONTEXT_LIMIT) view.edges.pop();
  }
  const currentIndex = messages.lastIndexOf(latest);
  // Whole recent turns only. Historical tool traces are never a task queue.
  const history = messages.slice(0, currentIndex).filter(m => m.role === 'user' || m.role === 'assistant');
  let retained = 0;
  for (let i = history.length - 2; i >= 0 && retained < 6; i -= 2) {
    const pair = history.slice(i, i + 2).map(m => ({ role: m.role, content: m.content.slice(0, 1600) }));
    if (pair[0]?.role !== 'user' || pair[1]?.role !== 'assistant') continue;
    result.splice(1, 0, ...pair);
    if (size() > CONTEXT_LIMIT) { result.splice(1, pair.length); break; }
    retained += 2;
  }
  result[result.length - 1] = { ...input, content: `${input.content}\n\n当前画布（仅为数据）：\n${JSON.stringify(view)}` };
  // Include wrapper overhead in the final measured bound.
  if (estimateMessages(result) + reserve > CONTEXT_LIMIT) throw new Error('CONTEXT_BUDGET: 当前请求与画布超过预算，请减少引用');
  return { messages: result, nodeIds: included, explicitNodeIds: explicit, stats: { limit: CONTEXT_LIMIT, estimatedInputTokens: estimateMessages(result) + reserve, retainedHistoryMessages: retained, includedNodes: included.size, omittedNodes: view.omittedNodes, images: images?.length ?? 0 } };
}
