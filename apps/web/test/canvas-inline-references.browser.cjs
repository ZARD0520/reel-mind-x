const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (text) => { window.__testClipboard = text; },
        readText: async () => window.__testClipboard ?? '',
      } });
    });
    const canvasId = randomUUID();
    let graph = { version: 1, nodes: [
      { id: 'target', position: { x: 400, y: 120 }, data: { kind: 'image', title: 'Target', prompt: '', status: 'idle' } },
      { id: 'source', position: { x: 850, y: 120 }, data: { kind: 'text', title: 'Source', content: 'source content', status: 'ready' } },
      { id: 'photo', position: { x: 1800, y: 120 }, data: { kind: 'image', title: 'Photo', url: '/reference-image.svg', status: 'ready' } },
      { id: 'clip', position: { x: 2400, y: 120 }, data: { kind: 'video', title: 'Clip', url: '/reference-video.mp4', status: 'ready' } },
    ], edges: [{ id: 'source-target', source: 'source', target: 'target' }], viewport: { x: 0, y: 0, zoom: 0.7 } };
    let generation;
    let sent;
    const conversation = { id: randomUUID(), title: 'Test', messages: [] };
    await page.route('**/reference-image.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="blue"/></svg>' }));
    await page.route('**/reference-video.mp4', (route) => route.fulfill({ status: 204 }));
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      let json = [];
      if (pathname === '/api/auth/me') json = { id: 'user', name: 'Test' };
      else if (pathname === `/api/canvases/${canvasId}`) {
        if (request.method() === 'PATCH') graph = request.postDataJSON().graph ?? graph;
        json = { id: canvasId, name: 'Inline references', graph };
      } else if (pathname === '/api/generation-tasks' && request.method() === 'POST') {
        generation = request.postDataJSON();
        json = { id: randomUUID(), requestId: generation.requestId, status: 'queued' };
      } else if (pathname.endsWith('/conversations') && request.method() === 'POST') json = conversation;
      else if (pathname.endsWith(`/conversations/${conversation.id}`)) json = conversation;
      else if (pathname.endsWith('/messages')) {
        sent = request.postDataJSON();
        conversation.messages = [{ id: 'user-message', role: 'user', content: sent.content, references: sent.references }];
        await route.fulfill({ contentType: 'text/event-stream', body: `event: delta\ndata: ${JSON.stringify({ text: 'OK' })}\n\nevent: done\ndata: ${JSON.stringify({ ...conversation, messages: [...conversation.messages, { id: 'answer', role: 'assistant', content: 'OK', references: [] }] })}\n\n` });
        return;
      }
      await route.fulfill({ json });
    });
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://localhost:5173'}/canvas/${canvasId}`);
    await page.locator('.react-flow__node[data-id="target"]').click();
    const input = page.locator('.react-flow__node-toolbar [role="textbox"]');
    await input.fill('editable prompt');
    await input.press('End');
    await input.click({ button: 'right' });
    const editMenu = page.getByRole('menu', { name: '\u63d0\u793a\u8bcd\u7f16\u8f91\u83dc\u5355' });
    await expect(editMenu.getByRole('menuitem')).toHaveCount(3);
    await expect(editMenu.getByRole('menuitem', { name: '\u590d\u5236', exact: true })).toBeDisabled();
    await expect(page.locator('[data-node-action-menu]')).toHaveCount(0);
    await editMenu.getByRole('menuitem', { name: '\u5168\u9009', exact: true }).click();
    expect(await page.evaluate(() => window.getSelection().toString())).toBe('editable prompt');
    await input.click({ button: 'right', position: { x: 20, y: 15 } });
    await expect(editMenu.getByRole('menuitem', { name: '\u590d\u5236', exact: true })).toBeEnabled();
    await editMenu.getByRole('menuitem', { name: '\u590d\u5236', exact: true }).click();
    expect(await page.evaluate(() => window.__testClipboard)).toBe('editable prompt');
    await page.evaluate(() => { window.__testClipboard = 'pasted prompt'; });
    await input.click({ button: 'right', position: { x: 20, y: 15 } });
    await editMenu.getByRole('menuitem', { name: '\u7c98\u8d34', exact: true }).click();
    await expect(input).toHaveText('pasted prompt');
    await input.dblclick({ position: { x: 20, y: 15 } });
    await expect(editMenu).toHaveCount(0);
    await expect(page.locator('[data-node-action-menu]')).toHaveCount(0);
    await input.press('Escape');
    await expect(editMenu).toHaveCount(0);
    await page.locator('.react-flow__node[data-id="target"]').click({ button: 'right' });
    await expect(page.locator('[data-node-action-menu]')).toBeVisible();
    await input.click();
    await expect(page.locator('[data-node-action-menu]')).toHaveCount(0);
    const promptPanel = page.locator('.react-flow__node-toolbar form');
    await promptPanel.click({ button: 'right', position: { x: 3, y: 3 } });
    await expect(editMenu).toHaveCount(0);
    await expect(page.locator('[data-node-action-menu]')).toHaveCount(0);
    await promptPanel.dblclick({ position: { x: 3, y: 3 } });
    await expect(editMenu).toHaveCount(0);
    await expect(page.locator('[data-node-action-menu]')).toHaveCount(0);
    await input.fill('before after');
    await input.press('Home');
    for (let i = 0; i < 7; i++) await input.press('ArrowRight');
    await input.pressSequentially('@Source');
    await page.getByRole('option', { name: /Source/ }).click();
    await expect(input).toHaveText('before Source after');
    await input.locator('[data-node-id="source"]').hover();
    await expect(page.getByRole('tooltip', { name: /^\u9884\u89c8\uff1a/ })).toContainText('source content');
    await page.mouse.move(10, 10);
    await expect(page.getByRole('tooltip', { name: /^\u9884\u89c8\uff1a/ })).toHaveCount(0);
    await expect.poll(() => graph.edges.map((edge) => [edge.source, edge.target])).toEqual([['source', 'target']]);
    await expect.poll(() => graph.nodes[0].data.referenceNodeIds).toEqual(['source']);
    await page.reload();
    await page.locator('.react-flow__node[data-id="target"]').click();
    await expect(input).toHaveText('before Source after');
    // Backspace at a chip boundary removes only the reference, retaining its dependency.
    await input.focus();
    await input.press('Home');
    for (let i = 0; i < 8; i++) await input.press('ArrowRight');
    await input.press('Backspace');
    await expect(input.locator('[data-node-id]')).toHaveCount(0);
    await expect(input).toHaveText('before  after');
    await expect.poll(() => graph.nodes[0].data.referenceNodeIds).toEqual([]);
    expect(graph.edges).toHaveLength(1);
    await input.pressSequentially('@Source');
    await input.press('Enter');
    await input.press('Enter');
    await expect.poll(() => generation?.prompt).toBe('before 【Source】source content  after');
    expect(generation.references).toHaveLength(1);
    await expect.poll(() => graph.nodes[0].data.status).toBe('generating');
    graph.nodes[0].data.status = 'idle';
    delete graph.nodes[0].data.generationStatus;
    delete graph.nodes[0].data.generationTaskId;
    await page.reload();
    await page.locator('.react-flow__node[data-id="target"]').click();

    // Expanding edits the same prompt and returns changes to the node editor.
    const addButtonBounds = await page.getByRole('button', { name: '添加参考节点', exact: true }).boundingBox();
    const expandButtonBounds = await page.getByRole('button', { name: '扩大提示词输入框' }).boundingBox();
    expect(expandButtonBounds.x).toBeGreaterThan(addButtonBounds.x);
    await page.getByRole('button', { name: '扩大提示词输入框' }).click();
    const dialog = page.getByRole('dialog', { name: '编辑节点提示词' });
    await expect(dialog.locator('[data-prompt-reference-list]')).toContainText('Source');
    await expect(dialog.getByRole('button', { name: '添加参考节点', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '选择生成数量' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '生成图片', exact: true })).toBeVisible();
    const expandedInput = dialog.getByRole('textbox');
    await expect(expandedInput.locator('[data-node-id="source"]')).toHaveCount(1);
    await expandedInput.press('End');
    await expandedInput.pressSequentially(' expanded');
    await dialog.getByRole('button', { name: '缩小提示词输入框' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(input).toContainText('expanded');
    await page.getByRole('button', { name: '扩大提示词输入框' }).click();
    await expandedInput.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Removing the dependency preserves the mention as an invalid reference.
    await page.getByRole('button', { name: '删除依赖 Source', exact: true }).click();
    const invalid = input.locator('[data-node-id="source"]');
    await expect(invalid).toHaveAttribute('data-inactive-reference', 'true');
    await expect(invalid).toHaveAttribute('title', '该资产已失效');
    await expect(invalid.locator('span').last()).toHaveClass(/line-through/);
    await invalid.hover();
    await expect(page.getByRole('tooltip', { name: '预览：Source' })).toContainText('该资产已失效');
    await page.mouse.move(10, 10);
    await expect.poll(() => graph.edges).toEqual([]);
    await page.reload();
    await page.locator('.react-flow__node[data-id="target"]').click();
    await expect(input.locator('[data-node-id="source"]')).toHaveAttribute('data-inactive-reference', 'true');

    await page.getByRole('button', { name: '打开 Agent Chat', exact: true }).click();
    const chat = page.locator('aside [role="textbox"]');
    await chat.fill('compare with result');
    await chat.evaluate((element) => {
      const range = document.createRange();
      range.setStart(element.firstChild, 8);
      range.collapse(true);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    });
    await chat.pressSequentially('@Source');
    await chat.press('Enter');
    await expect(chat).toHaveText('compare Source with result');
    // Clicking a draft reference restores the canvas navigation behavior.
    await chat.locator('[data-node-id="source"]').click();
    await expect(page.locator('.react-flow__node[data-id="source"]')).toHaveClass(/selected/);
    await expect(chat).toHaveText('compare Source with result');
    await chat.focus();
    await chat.press('Enter');
    await expect.poll(() => sent?.references?.map((item) => item.id)).toEqual(['source']);
    expect(sent.content).toBe('compare @[Source](node:source) with result');
    await expect(page.locator('aside').getByRole('button', { name: '定位到画布节点 Source' }).last()).toBeVisible();
    const bubble = page.locator('aside .self-end').last();
    await expect(bubble).toHaveText('compare Source with result');
    await bubble.getByRole('button', { name: '定位到画布节点 Source' }).hover();
    await expect(page.getByRole('tooltip', { name: /^\u9884\u89c8\uff1a/ })).toContainText('source content');
    await page.mouse.move(10, 10);
    await expect(page.getByRole('tooltip', { name: /^\u9884\u89c8\uff1a/ })).toHaveCount(0);

    await chat.fill('@');
    const options = page.getByRole('option');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('option', { name: /Source/ }).hover();
    await expect(page.getByRole('option', { name: /Source/ })).toHaveAttribute('aria-selected', 'true');
    await expect(options.first()).toHaveAttribute('aria-selected', 'false');
    await chat.press('Enter');
    await expect(chat).toHaveText('Source ');
    await chat.pressSequentially('@Photo');
    await chat.press('Enter');
    await chat.pressSequentially('@Clip');
    await chat.press('Enter');
    const chips = chat.locator('[data-node-id]');
    await expect(chips).toHaveCount(3);
    expect(await chips.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height))).toEqual([24, 24, 24]);
    await expect(chat.locator('[data-node-id="photo"] [data-reference-kind="image"]')).toBeVisible();
    await expect(chat.locator('[data-node-id="clip"] [data-reference-kind="video"]')).toBeVisible();
    await chat.locator('[data-node-id="photo"]').hover();
    await expect(page.getByRole('tooltip', { name: /^\u9884\u89c8\uff1a/ }).locator('img')).toHaveAttribute('src', '/reference-image.svg');
    await chat.locator('[data-node-id="clip"]').hover();
    const videoPreview = page.getByRole('tooltip', { name: /^\u9884\u89c8\uff1a/ }).locator('video');
    await expect(videoPreview).toHaveAttribute('src', '/reference-video.mp4');
    expect(await videoPreview.evaluate((element) => element.autoplay && element.muted && element.loop)).toBe(true);
    await page.mouse.move(10, 10);
    await expect(page.getByRole('tooltip', { name: /^\u9884\u89c8\uff1a/ })).toHaveCount(0);
    // The remove button still removes the mention without locating its node.
    await expect(page.locator('.react-flow__node[data-id="source"]')).toHaveClass(/selected/);
    await chat.locator('[data-node-id="photo"] button').click();
    await expect(page.locator('.react-flow__node[data-id="source"]')).toHaveClass(/selected/);
    await expect(chat.locator('[data-node-id="photo"]')).toHaveCount(0);
    await expect(chips).toHaveCount(2);
    expect(errors).toEqual([]);
    console.log('PASS: prompt edit menu, copy/paste/select-all, selection-aware copy, double-click isolation, node menu, inline references and hover previews');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
