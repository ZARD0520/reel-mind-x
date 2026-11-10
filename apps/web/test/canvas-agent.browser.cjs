const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8899';
    const insecureHttp = process.env.E2E_INSECURE_HTTP === '1';
    const browserOrigin = insecureHttp ? 'http://agent-http.test' : baseUrl;
    if (insecureHttp) {
      // Keep a genuine non-secure browser origin, while serving the app from
      // the local test server. API mocks below take precedence over this route.
      await page.route(`${browserOrigin}/**`, async route => {
        const target = new URL(route.request().url());
        const upstream = new URL(baseUrl);
        target.protocol = upstream.protocol;
        target.host = upstream.host;
        await route.fulfill({ response: await route.fetch({ url: target.toString() }) });
      });
    }
    await page.addInitScript(() => {
      const original = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const response = await original(...args);
        if (!String(args[0]).endsWith('/messages') || !response.headers.get('content-type')?.includes('text/event-stream')) return response;
        const body = await response.text();
        const plan = body.indexOf('event: plan\n');
        if (plan < 0) return new Response(body, { headers: response.headers });
        const end = body.indexOf('\n\n', plan) + 2;
        return new Response(new ReadableStream({ start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(body.slice(0, end)));
          setTimeout(() => { controller.enqueue(encoder.encode(body.slice(end))); controller.close(); }, 900);
        } }), { headers: response.headers });
      };
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const canvasId = randomUUID();
    let graph = { version: 1, nodes: [{ id: 'story', type: 'workflow', position: { x: 200, y: 160 }, data: { kind: 'text', title: '小狗的故事', content: '小狗出门、迷路、遇到朋友、一起回家', prompt: '', status: 'ready' } }], edges: [], viewport: { x: 0, y: 0, zoom: 0.8 } };
    graph.nodes.push(...Array.from({ length: 8 }, (_, index) => ({ id: `existing-${index}`, type: 'workflow', position: { x: 5000, y: index * 560 }, data: { kind: index === 7 ? 'audio' : 'image', title: index === 7 ? '已有音频' : `已有图片${index}`, content: '', prompt: '', status: 'idle' } })));
    const conversation = { id: randomUUID(), title: '分镜创作', messages: [], agentRuns: [] };
    let submitted;
    let chatRequests = 0;
    let generationRequests = 0;
    let scenario = 'success';
    let mediaTask = null;
    let detailReads = 0;
    const rawError = 'GLM API 调用失败 (429): {"error":{"code":"1305","message":"private provider diagnostics"}}';
    const friendlyError = '当前业务模型繁忙，请稍后再试。';
    await page.route('**/api/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      let json = [];
      if (pathname === '/api/auth/me') json = { id: 'owner', name: 'Test' };
      else if (pathname === `/api/canvases/${canvasId}`) {
        if (request.method() === 'PATCH') graph = request.postDataJSON().graph ?? graph;
        json = { id: canvasId, name: 'Agent integration', graph, updatedAt: new Date().toISOString() };
      } else if (pathname.endsWith('/conversations')) json = request.method() === 'POST' ? conversation : [conversation];
      else if (pathname.endsWith(`/conversations/${conversation.id}`)) { detailReads++; json = conversation; }
      else if (pathname.endsWith('/messages')) {
        chatRequests++;
        submitted = request.postDataJSON();
        if (scenario === 'media-waiting') {
          const runId = randomUUID();
          const node = graph.nodes.find(n => n.id === 'shot-0');
          mediaTask = { id: randomUUID(), requestId: randomUUID(), nodeId: node.id, model: 'cogview-3-flash', revision: 0, createdAt: new Date().toISOString(), status: 'queued', error: null, canResume: false,
            items: [{ id: randomUUID(), index: 0, status: 'queued', asset: null }] };
          node.data = { ...node.data, status: 'generating', generationStatus: 'queued', generationRevision: 0,
            generationTaskId: mediaTask.id, generationRequestId: mediaTask.requestId, generationStartedAt: mediaTask.createdAt };
          conversation.messages.push({ id: randomUUID(), role: 'user', content: submitted.content, references: [] }, { id: randomUUID(), role: 'assistant', content: '已提交图片生成任务，正在后台生成。', references: [] });
          conversation.agentRuns.push({ id: runId, status: 'waiting_generation', events: [] });
          await route.fulfill({ contentType: 'text/event-stream', body: `event: canvas\ndata: ${JSON.stringify({ graph })}\n\nevent: delta\ndata: ${JSON.stringify({ text: conversation.messages.at(-1).content })}\n\nevent: done\ndata: ${JSON.stringify(conversation)}\n\n` });
          return;
        }
        if (scenario === 'cached') {
          await route.fulfill({ contentType: 'text/event-stream', body: `event: done\ndata: ${JSON.stringify(conversation)}\n\n` });
          return;
        }
        if (scenario === 'legacy-error') {
          await route.fulfill({ contentType: 'text/event-stream', body: `event: error\ndata: ${JSON.stringify({ message: rawError })}\n\n` });
          return;
        }
        if (scenario === 'persisted-error') {
          conversation.messages.push({ id: randomUUID(), role: 'user', content: submitted.content, references: [] }, { id: randomUUID(), role: 'assistant', content: friendlyError, references: [] });
          conversation.agentRuns.push({ id: randomUUID(), status: 'failed', error: rawError, events: [{ id: 'failed-tool', runId: 'failed-run', name: 'create_nodes', title: '创建节点', status: 'failed', result: { message: rawError } }] });
          await route.fulfill({ contentType: 'text/event-stream', body: `event: delta\ndata: ${JSON.stringify({ text: 'partial response' })}\n\nevent: replace\ndata: ${JSON.stringify({ text: friendlyError })}\n\nevent: done\ndata: ${JSON.stringify(conversation)}\n\n` });
          return;
        }
        expect(submitted.selectedNodeIds).toContain('story');
        expect(submitted.requestId).toMatch(/^[a-f0-9-]{36}$/);
        const created = ['出门', '迷路', '相遇', '回家'].map((title, index) => ({ id: `shot-${index}`, type: 'workflow', position: { x: 750 + index * 500, y: 160 }, data: { kind: 'image', title, prompt: `分镜：${title}`, status: 'idle' } }));
        graph = { ...graph, nodes: [...graph.nodes, ...created], edges: created.map(node => ({ id: `story-${node.id}`, source: 'story', target: node.id })) };
        const runId = randomUUID();
        const operations = ['读取画布', '创建节点', '建立连接'].map((title, index) => ({ id: `call-${index}`, runId, name: ['get_canvas_context', 'create_nodes', 'connect_nodes'][index], title, status: 'completed' }));
        conversation.messages = [{ id: randomUUID(), role: 'user', content: submitted.content, references: submitted.references }, { id: randomUUID(), role: 'assistant', content: '已创建四个分镜节点并建立连接。', references: [] }];
        conversation.agentRuns = [{ id: runId, status: 'completed', events: operations }];
        const events = [
          { event: 'plan', data: { runId, mode: 'execute', goal: '创建四个故事分镜', steps: [{ id: 'shots', description: '创建四个分镜并引用故事', tool: 'create_nodes' }] } },
          ...operations.flatMap(operation => [{ event: 'tool', data: { ...operation, status: 'running' } }, { event: 'tool', data: operation }]),
          { event: 'canvas', data: { graph, revision: new Date().toISOString() } },
          { event: 'delta', data: { text: '已创建四个分镜节点并建立连接。' } },
          { event: 'done', data: conversation },
        ];
        await route.fulfill({ contentType: 'text/event-stream', body: events.map(event => `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`).join('') });
        return;
      } else if (pathname === '/api/generation-tasks') {
        if (request.method() === 'POST') generationRequests++;
        else json = mediaTask ? [mediaTask] : [];
      }
      await route.fulfill({ json });
    });
    await page.goto(`${browserOrigin}/canvas/${canvasId}`);
    if (insecureHttp) {
      expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
      expect(await page.evaluate(() => typeof globalThis.crypto?.randomUUID)).toBe('undefined');
    }
    await page.getByRole('button', { name: '连接关系', exact: true }).click();
    await page.locator('.react-flow__node[data-id="story"]').click();
    await page.getByRole('button', { name: '选择文本生成模型', exact: true }).click();
    const modelMenu = page.getByRole('listbox', { name: '选择文本生成模型' });
    await expect(modelMenu).toHaveCSS('user-select', 'none');
    await expect(modelMenu.getByRole('option').first()).toHaveCSS('user-select', 'none');
    await modelMenu.getByRole('option').first().click();
    await page.getByRole('button', { name: '打开 Agent Chat', exact: true }).click();
    await page.locator('aside [role="textbox"]').fill('根据选中的故事创建四个分镜节点');
    await page.locator('aside button[aria-label="发送消息"]').click();
    await expect.poll(() => chatRequests).toBe(1);
    await expect(page.getByLabel('小X正在回复')).toBeVisible();
    await expect(page.getByLabel('本轮执行计划')).toHaveCount(0);
    await expect(page.getByLabel('Agent 执行记录')).toHaveCount(0);
    await expect(page.locator('.react-flow__node')).toHaveCount(13);
    await expect(page.locator('.react-flow__edge')).toHaveCount(4);
    await expect(page.getByLabel('Agent 执行记录')).toHaveCount(0);
    await expect(page.getByLabel('本轮执行计划')).toHaveCount(0);
    await expect(page.locator('aside[aria-hidden="false"]')).toContainText('已创建四个分镜节点并建立连接。');
    await expect(page.locator('aside button[aria-label="发送消息"] svg.animate-spin')).toHaveCount(0);
    const liveComposer = page.locator('aside [role="textbox"]');
    await liveComposer.fill('@');
    const liveMenu = page.getByRole('listbox', { name: '引用画布节点' });
    await expect(liveMenu.getByRole('option')).toHaveCount(13);
    for (const title of ['出门', '迷路', '相遇', '回家']) await expect(liveMenu.getByRole('option', { name: new RegExp(title) })).toHaveCount(1);
    await expect(liveMenu.getByRole('option', { name: /已有音频/ })).toContainText('音频');
    for (let index = 0; index < 12; index++) await liveComposer.press('ArrowDown');
    await expect(liveMenu.getByRole('option', { name: /回家/ })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => liveMenu.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await liveComposer.press('Enter');
    await expect(liveComposer.locator('[data-node-id="shot-3"]')).toHaveCount(1);
    await liveComposer.fill('@相遇');
    await expect(liveMenu.getByRole('option')).toHaveCount(1);
    await liveComposer.press('Enter');
    await expect(liveComposer.locator('[data-node-id="shot-2"]')).toHaveCount(1);
    await liveComposer.fill('');
    await page.waitForTimeout(1200); // Let the autosave debounce run: it must retain agent changes.
    expect(graph.nodes).toHaveLength(13);
    expect(graph.edges).toHaveLength(4);
    expect(generationRequests).toBe(0);
    await page.reload();
    await expect(page.locator('.react-flow__node')).toHaveCount(13);
    await page.getByRole('button', { name: '打开 Agent Chat', exact: true }).click();
    await expect(page.getByLabel('Agent 执行记录')).toHaveCount(0);
    const drawer = page.locator('aside[aria-hidden="false"]');
    const composer = drawer.getByRole('textbox');
    scenario = 'cached';
    await composer.fill('根据选中的故事创建四个分镜节点');
    await drawer.locator('button[aria-label="发送消息"]').click();
    await expect(drawer.locator('button[aria-label="发送消息"] svg.animate-spin')).toHaveCount(0);
    await expect(drawer).not.toContainText('思考中...');
    scenario = 'persisted-error';
    await composer.fill('让模型处理一个新问题');
    await drawer.locator('button[aria-label="发送消息"]').click();
    const errorMessage = drawer.getByText(friendlyError, { exact: true });
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toHaveCSS('color', 'rgb(222, 222, 219)');
    await expect(drawer).not.toContainText('GLM API');
    await expect(drawer).not.toContainText('private provider diagnostics');
    await expect(drawer).not.toContainText('partial response');
    await expect(drawer.locator('[role="alert"]')).toHaveCount(0);
    await expect(drawer.locator('button[aria-label="发送消息"] svg.animate-spin')).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: '打开 Agent Chat', exact: true }).click();
    await expect(drawer.getByText(friendlyError, { exact: true })).toHaveCount(1);
    await expect(drawer).not.toContainText('private provider diagnostics');
    scenario = 'legacy-error';
    await composer.fill('再试一次');
    await drawer.locator('button[aria-label="发送消息"]').click();
    await expect(drawer.getByText(friendlyError, { exact: true })).toHaveCount(2);
    await expect(drawer).toContainText('再试一次');
    await expect(drawer).not.toContainText('GLM API');
    await expect(composer).toHaveText('');
    await expect(drawer.locator('[role="alert"]')).toHaveCount(0);
    scenario = 'media-waiting';
    await page.locator('.react-flow__node[data-id="shot-0"]').evaluate(element => {
      window.__imageHiddenFrames = [];
      new MutationObserver(() => {
        if (element.style.visibility === 'hidden') window.__imageHiddenFrames.push(element.getAttribute('style'));
      }).observe(element, { attributes: true, attributeFilter: ['style'] });
    });
    for (const round of [1, 2]) {
      await composer.fill('为出门分镜生成一张图片');
      await drawer.locator('button[aria-label="发送消息"]').click();
      await expect(drawer).toContainText('已提交图片生成任务，正在后台生成。');
      await expect(drawer.locator('button[aria-label="发送消息"] svg.animate-spin')).toHaveCount(0);
      const beforePolling = detailReads;
      await expect.poll(() => detailReads, { timeout: 8000 }).toBeGreaterThan(beforePolling);
      mediaTask.status = 'completed'; mediaTask.items[0].status = 'completed';
      const imageUrl = `/files/phase2-${round}.png`;
      mediaTask.items[0].asset = { id: randomUUID(), kind: 'image', status: 'ready', url: imageUrl, content: null, model: 'cogview-3-flash' };
      Object.assign(graph.nodes.find(node => node.id === 'shot-0').data, {
        status: 'ready', generationStatus: 'completed', generationRevision: 2,
        generationAppliedTaskId: mediaTask.id, generationBatchResultsTaskId: mediaTask.id,
        assetId: mediaTask.items[0].asset.id, url: mediaTask.items[0].asset.url,
      });
      mediaTask.revision = 2;
      conversation.agentRuns.at(-1).status = 'completed';
      conversation.messages.at(-1).content = '图片生成完成：1 张成功。结果已更新到画布。';
      await page.route(`**${imageUrl}`, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>' }));
      await expect(drawer).toContainText('图片生成完成：1 张成功。结果已更新到画布。', { timeout: 10000 });
      await expect(page.locator('.react-flow__node[data-id="shot-0"] img').first()).toHaveAttribute('src', imageUrl);
      await expect(page.locator('.react-flow__node[data-id="shot-0"]')).toBeVisible();
      await expect.poll(() => page.locator('.react-flow__node[data-id="shot-0"] img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
      expect(await page.evaluate(() => window.__imageHiddenFrames)).toEqual([]);
      await page.waitForTimeout(1200);
      expect(graph.nodes).toHaveLength(13);
      await expect(page.locator('.react-flow__node')).toHaveCount(13);
    }
    await page.reload();
    await expect(page.locator('.react-flow__node')).toHaveCount(13);
    await expect(page.locator('.react-flow__node[data-id="shot-0"]')).toBeVisible();
    await expect(page.locator('.react-flow__node[data-id="shot-0"] img').first()).toHaveAttribute('src', '/files/phase2-2.png');
    expect(generationRequests).toBe(0, 'browser observes backend generation; it must not submit duplicate jobs');
    expect(errors).toEqual([]);
    console.log(`PASS: ${insecureHttp ? 'insecure HTTP' : 'normal'} canvas agent requests, updates, error sanitization, persistence, legacy fallback and repeated image generation without hiding existing nodes`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
