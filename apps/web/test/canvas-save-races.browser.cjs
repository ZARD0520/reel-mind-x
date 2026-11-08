const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');
const { mergeCanvasGraphs } = createRequire(path.resolve(__dirname, '../../api/package.json'))('@reel/contracts');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const canvasId = randomUUID(), conversationId = randomUUID();
    const node = (id, x) => ({ id, type: 'workflow', position: { x, y: 120 }, data: { kind: 'text', title: id, content: '测试正文', prompt: '', status: 'ready' } });
    let graph = { version: 1, nodes: [node('source', 100), node('victim', 550)], edges: [{ id: 'link', source: 'source', target: 'victim' }], viewport: { x: 0, y: 0, zoom: 0.8 } };
    const conversation = { id: conversationId, title: '保存时序', messages: [], agentRuns: [{ id: randomUUID(), status: 'completed', backgroundPending: false, events: [] }] };
    let deleteHeld = false, releaseDelete, syncHeld = false, releaseSync;
    let holdSync = false, canvasReads = 0, messages = 0, failSync = false, syncFailed = false;
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()); let json = [];
      if (url.pathname === '/api/auth/me') json = { id: 'owner', name: 'Test' };
      else if (url.pathname === `/api/canvases/${canvasId}`) {
        if (request.method() === 'PATCH') {
          const input = request.postDataJSON(); graph = mergeCanvasGraphs(input.baseGraph, input.graph, graph);
          if (!deleteHeld && !input.graph.nodes.some(n => n.id === 'victim')) {
            deleteHeld = true;
            const response = { id: canvasId, name: '保存时序', graph: structuredClone(graph) };
            await new Promise(resolve => { releaseDelete = resolve; });
            await route.fulfill({ json: response }); return;
          }
        } else {
          canvasReads++;
          if (failSync && canvasReads >= 2) { syncFailed = true; await route.fulfill({ status: 503, json: { message: 'fixture sync unavailable' } }); return; }
          if (holdSync && canvasReads >= 2 && !syncHeld) {
            syncHeld = true; const response = { id: canvasId, name: '保存时序', graph: structuredClone(graph) };
            await new Promise(resolve => { releaseSync = resolve; });
            await route.fulfill({ json: response }); return;
          }
        }
        json = { id: canvasId, name: '保存时序', graph };
      } else if (url.pathname.endsWith('/conversations')) json = [conversation];
      else if (url.pathname.endsWith(`/conversations/${conversationId}`)) json = conversation;
      else if (url.pathname.endsWith('/messages')) {
        messages++; const input = request.postDataJSON(); expect(input.selectedNodeIds).toContain('source');
        graph.nodes.find(n => n.id === 'source').data.title = '新任务完成';
        conversation.messages.push({ id: randomUUID(), role: 'user', content: input.content, references: [] }, { id: randomUUID(), role: 'assistant', content: '已完成新任务。', references: [] });
        conversation.agentRuns = [{ id: randomUUID(), status: 'completed', backgroundPending: false, events: [] }];
        await route.fulfill({ contentType: 'text/event-stream', body: `event: canvas\ndata: ${JSON.stringify({ graph })}\n\nevent: delta\ndata: ${JSON.stringify({ text: '已完成新任务。' })}\n\nevent: done\ndata: ${JSON.stringify(conversation)}\n\n` }); return;
      }
      await route.fulfill({ json });
    });
    const base = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
    await page.goto(`${base}/canvas/${canvasId}`);
    const victim = page.locator('.react-flow__node[data-id="victim"]');
    await expect(victim).toBeVisible();
    for (const delay of [1200, 150]) {
      deleteHeld = false;
      await victim.locator('.workflow-node-title').click(); await page.keyboard.press('Delete');
      await expect(victim).toHaveCount(0);
      await expect.poll(() => deleteHeld).toBe(true);
      await page.keyboard.press('Control+z'); await expect(victim).toHaveCount(1);
      // Exercise acknowledgments on either side of the undo's debounce.
      graph.nodes.push(node(`server-addition-${delay}`, 1000 + delay));
      await page.waitForTimeout(delay); releaseDelete();
      await expect.poll(() => graph.nodes.some(n => n.id === 'victim'), { timeout: 10000 }).toBe(true);
      await expect(victim).toHaveCount(1); expect(graph.edges.some(e => e.id === 'link')).toBe(true);
      await expect(page.locator(`.react-flow__node[data-id="server-addition-${delay}"]`)).toHaveCount(1);
    }

    // A new chat turn must wait for an in-flight background sync, then use the
    // current graph; the older GET response must not overwrite the new turn.
    conversation.agentRuns[0].status = 'waiting_generation'; conversation.agentRuns[0].backgroundPending = true;
    holdSync = true; canvasReads = 0;
    await page.reload(); await expect.poll(() => syncHeld).toBe(true);
    await page.locator('.react-flow__node[data-id="source"] .workflow-node-title').click();
    await page.getByRole('button', { name: '打开 Agent Chat', exact: true }).click();
    await page.locator('aside [role="textbox"]').fill('把选中的节点重命名为新任务完成');
    graph.nodes.push(node('while-sync', 1450));
    await page.locator('aside button[aria-label="发送消息"]').click();
    releaseSync();
    await expect.poll(() => messages).toBe(1);
    await expect(page.locator('aside[aria-hidden="false"]')).toContainText('已完成新任务。');
    await expect(page.locator('.react-flow__node')).toHaveCount(5);
    await expect(page.locator('.react-flow__node[data-id="source"]')).toContainText('新任务完成');
    await expect(page.locator('aside button[aria-label="发送消息"] svg.animate-spin')).toHaveCount(0);
    conversation.agentRuns[0].status = 'waiting_generation'; conversation.agentRuns[0].backgroundPending = true;
    failSync = true; canvasReads = 0;
    await page.reload(); await expect.poll(() => syncFailed).toBe(true);
    failSync = false;
    await page.locator('.react-flow__node[data-id="source"] .workflow-node-title').click();
    await page.getByRole('button', { name: '打开 Agent Chat', exact: true }).click();
    await page.locator('aside [role="textbox"]').fill('同步恢复后处理我的新指令');
    await page.locator('aside button[aria-label="发送消息"]').click();
    await expect.poll(() => messages).toBe(2);
    await expect(page.locator('aside button[aria-label="发送消息"] svg.animate-spin')).toHaveCount(0);
    expect(errors).toEqual([]);
    console.log('PASS: undo survives both slow-save timings; new Agent turns safely follow in-flight and failed background sync');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
