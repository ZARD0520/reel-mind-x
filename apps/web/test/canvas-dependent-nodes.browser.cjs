const { chromium, expect } = require('@playwright/test');
const { randomUUID: uuid } = require('node:crypto');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
    const id = uuid();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let graph = { version: 1, viewport: { x: 160, y: 100, zoom: 0.6 }, edges: [], nodes: ['text', 'image', 'video', 'audio'].map((kind, i) => ({ id: kind, type: 'workflow', position: { x: i % 2 * 1100, y: Math.floor(i / 2) * 720 }, data: { kind, title: kind, content: kind === 'text' ? 'source text' : '', status: 'ready', uploaded: kind !== 'text' } })) };
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let json = [];
      if (path === '/api/auth/me') json = { id: uuid(), name: 'Test' };
      else if (path === `/api/canvases/${id}`) {
        if (route.request().method() === 'PATCH') graph = route.request().postDataJSON().graph ?? graph;
        json = { id, name: 'Dependent nodes', graph };
      }
      await route.fulfill({ json });
    });
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173'}/canvas/${id}`);
    const menu = page.getByRole('menu', { name: '添加下游节点' });
    const source = kind => page.locator(`.react-flow__node[data-id="${kind}"]`).getByRole('button', { name: '添加下游节点', exact: true });
    const options = { text: ['文本节点', '图片节点', '视频节点', '音频节点'], image: ['文本节点', '图片节点', '视频节点', '智能剪辑'], video: ['文本节点', '智能剪辑'], audio: ['视频节点', '智能剪辑'] };
    for (const [kind, labels] of Object.entries(options)) {
      await source(kind).click();
      await expect(menu).toBeVisible();
      expect(await menu.getByRole('menuitem').allTextContents()).toEqual(labels);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    }
    await source('image').click();
    await menu.getByRole('menuitem', { name: '图片节点' }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(5);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await expect.poll(() => graph.nodes.length).toBe(5);
    const added = graph.nodes.find(n => !options[n.id]);
    expect(added.data.kind).toBe('image');
    expect(added.data.model).toBe('Kwai-Kolors/Kolors');
    expect(added.data.referenceNodeIds).toEqual(['image']);
    expect(graph.edges[0]).toMatchObject({ source: 'image', target: added.id });
    // Node creation and its dependency must undo/redo together.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+z');
    await expect(page.locator('.react-flow__node')).toHaveCount(4);
    await expect(page.locator('.react-flow__edge')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await expect(page.locator('.react-flow__node')).toHaveCount(5);
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    // Native handle dragging still connects existing nodes without opening a menu.
    const from = await source('text').boundingBox();
    const target = page.locator(`.react-flow__node[data-id="${added.id}"] .react-flow__handle.target`).first();
    const to = await target.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
    await page.mouse.up();
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);
    await expect(menu).toHaveCount(0);
    await source('audio').click();
    await menu.getByRole('menuitem', { name: '智能剪辑' }).click();
    await expect(page.getByLabel('智能剪辑名称')).toBeVisible();
    await expect.poll(() => graph.nodes.length).toBe(6);
    const edit = graph.nodes.find(n => n.data.kind === 'edit');
    expect(graph.edges.some(edge => edge.source === 'audio' && edge.target === edit.id)).toBe(true);
    expect(errors).toEqual([]);
    console.log('PASS: compatible downstream menus, references, atomic undo/redo, smart editing and existing drag connections');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
