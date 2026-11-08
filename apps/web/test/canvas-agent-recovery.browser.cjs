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
    let graph = { version: 1, nodes: [{ id: 'story', type: 'workflow', position: { x: 180, y: 140 }, data: { kind: 'text', title: '故事', content: '测试故事', prompt: '', status: 'ready' } }], edges: [], viewport: { x: 0, y: 0, zoom: 0.8 } };
    const conversation = { id: conversationId, title: '后台恢复测试', messages: [{ id: randomUUID(), role: 'assistant', content: '计划已保存，图片任务将在后台继续执行。', references: [] }],
      agentRuns: [{ id: randomUUID(), status: 'interrupted', backgroundPending: true, events: [] }] };
    let details = 0, saves = 0, duplicateSubmissions = 0;
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()); let json = [];
      if (url.pathname === '/api/auth/me') json = { id: 'owner', name: 'Test' };
      else if (url.pathname === `/api/canvases/${canvasId}`) {
        if (request.method() === 'PATCH') { const input = request.postDataJSON(); expect(input.baseGraph).toBeTruthy(); graph = mergeCanvasGraphs(input.baseGraph, input.graph, graph); saves++; }
        json = { id: canvasId, name: '后台恢复', graph, updatedAt: new Date().toISOString() };
      } else if (url.pathname.endsWith('/conversations')) json = [conversation];
      else if (url.pathname.endsWith(`/conversations/${conversationId}`)) { details++; json = conversation; }
      else if (request.method() === 'POST' && (url.pathname.endsWith('/messages') || url.pathname === '/api/generation-tasks')) duplicateSubmissions++;
      await route.fulfill({ json });
    });
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173'}/canvas/${canvasId}`);
    const story = page.locator('.react-flow__node[data-id="story"]');
    await expect(story).toBeVisible();
    await story.locator('.workflow-node-title').dblclick();
    const title = story.locator('.workflow-node-title input'); await title.fill('用户编辑保留'); await title.press('Enter');
    // Simulate the backend continuing after the browser reloaded immediately
    // after planning. There was no new-node SSE event in this visit.
    graph.nodes.push({ id: 'background-image', type: 'workflow', position: { x: 680, y: 140 }, data: { kind: 'image', title: '后台新增图片', prompt: '绘制小狗', content: '', status: 'idle', referenceNodeIds: ['story'] } });
    graph.edges.push({ id: 'new-edge', source: 'story', target: 'background-image' });
    const initialReads = details;
    await expect.poll(() => details, { timeout: 10000 }).toBeGreaterThan(initialReads);
    await expect(page.locator('.react-flow__node[data-id="background-image"]')).toHaveCount(1);
    await expect(story).toContainText('用户编辑保留');
    await expect.poll(() => graph.nodes.find(n => n.id === 'story').data.title).toBe('用户编辑保留');
    expect(graph.nodes).toHaveLength(2); expect(graph.edges).toHaveLength(1);
    await page.getByRole('button', { name: '打开 Agent Chat', exact: true }).click();
    const composer = page.locator('aside [role="textbox"]'); await composer.fill('@后台');
    await expect(page.getByRole('listbox', { name: '引用画布节点' }).getByRole('option')).toHaveCount(1);
    await composer.press('Escape'); await composer.fill('');
    conversation.agentRuns[0].status = 'completed'; conversation.agentRuns[0].backgroundPending = false;
    conversation.messages[0].content = '后台恢复完成';
    await expect(page.locator('aside[aria-hidden="false"]')).toContainText('后台恢复完成', { timeout: 10000 });
    await page.waitForTimeout(1600);
    const stableSaves = saves; await page.waitForTimeout(1600);
    expect(saves).toBe(stableSaves, 'sync/normalization must not create an autosave loop');
    await page.reload();
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    await expect(page.locator('.react-flow__node[data-id="story"]')).toContainText('用户编辑保留');
    expect(duplicateSubmissions).toBe(0); expect(errors).toEqual([]);
    console.log('PASS: reloaded interrupted media plans refresh nodes, references and results while preserving local edits, with no duplicate jobs or autosave loop');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
