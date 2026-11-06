const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const canvasId = randomUUID();
    let graph = { version: 1, nodes: [{ id: 'story', type: 'workflow', position: { x: 200, y: 160 }, data: { kind: 'text', title: '小狗的故事', content: '小狗出门、迷路、遇到朋友、一起回家', prompt: '', status: 'ready' } }], edges: [], viewport: { x: 0, y: 0, zoom: 0.8 } };
    const conversation = { id: randomUUID(), title: '分镜创作', messages: [], agentRuns: [] };
    let submitted;
    let generationRequests = 0;
    await page.route('**/api/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      let json = [];
      if (pathname === '/api/auth/me') json = { id: 'owner', name: 'Test' };
      else if (pathname === `/api/canvases/${canvasId}`) {
        if (request.method() === 'PATCH') graph = request.postDataJSON().graph ?? graph;
        json = { id: canvasId, name: 'Agent integration', graph, updatedAt: new Date().toISOString() };
      } else if (pathname.endsWith('/conversations')) json = request.method() === 'POST' ? conversation : [conversation];
      else if (pathname.endsWith(`/conversations/${conversation.id}`)) json = conversation;
      else if (pathname.endsWith('/messages')) {
        submitted = request.postDataJSON();
        expect(submitted.selectedNodeIds).toContain('story');
        const created = ['出门', '迷路', '相遇', '回家'].map((title, index) => ({ id: `shot-${index}`, type: 'workflow', position: { x: 750 + index * 500, y: 160 }, data: { kind: 'image', title, prompt: `分镜：${title}`, status: 'idle' } }));
        graph = { ...graph, nodes: [...graph.nodes, ...created], edges: created.map(node => ({ id: `story-${node.id}`, source: 'story', target: node.id })) };
        const runId = randomUUID();
        const operations = ['读取画布', '创建节点', '建立连接'].map((title, index) => ({ id: `call-${index}`, runId, name: ['get_canvas_context', 'create_nodes', 'connect_nodes'][index], title, status: 'completed' }));
        conversation.messages = [{ id: randomUUID(), role: 'user', content: submitted.content, references: submitted.references }, { id: randomUUID(), role: 'assistant', content: '已创建四个分镜节点并建立连接。', references: [] }];
        conversation.agentRuns = [{ id: runId, status: 'completed', events: operations }];
        const events = [
          ...operations.flatMap(operation => [{ event: 'tool', data: { ...operation, status: 'running' } }, { event: 'tool', data: operation }]),
          { event: 'canvas', data: { graph, revision: new Date().toISOString() } },
          { event: 'delta', data: { text: '已创建四个分镜节点并建立连接。' } },
          { event: 'done', data: conversation },
        ];
        await route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`).join('') });
        return;
      } else if (pathname === '/api/generation-tasks' && request.method() === 'POST') generationRequests++;
      await route.fulfill({ json });
    });
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8899'}/canvas/${canvasId}`);
    await page.locator('.react-flow__node[data-id="story"]').click();
    await page.getByRole('button', { name: '打开 Agent Chat', exact: true }).click();
    await page.locator('aside [role="textbox"]').fill('根据选中的故事创建四个分镜节点');
    await page.locator('aside button[aria-label="发送消息"]').click();
    await expect(page.locator('.react-flow__node')).toHaveCount(5);
    await expect(page.getByLabel('Agent 执行记录')).toContainText('创建节点 · 已完成');
    await expect(page.locator('aside[aria-hidden="false"]')).toContainText('已创建四个分镜节点并建立连接。');
    await expect(page.locator('aside button[aria-label="发送消息"] svg.animate-spin')).toHaveCount(0);
    await page.waitForTimeout(1200); // Let the autosave debounce run: it must retain agent changes.
    expect(graph.nodes).toHaveLength(5);
    expect(graph.edges).toHaveLength(4);
    expect(generationRequests).toBe(0);
    await page.reload();
    await expect(page.locator('.react-flow__node')).toHaveCount(5);
    await page.getByRole('button', { name: '打开 Agent Chat', exact: true }).click();
    await expect(page.getByLabel('Agent 执行记录')).toContainText('建立连接 · 已完成');
    expect(errors).toEqual([]);
    console.log('PASS: selected-node context, agent progress, canvas updates, autosave safety and persisted results; no generation submitted');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
