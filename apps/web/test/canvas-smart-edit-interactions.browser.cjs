const { chromium, expect } = require('@playwright/test');
const { randomUUID: uuid } = require('node:crypto');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const id = uuid();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let choosers = 0;
    page.on('filechooser', () => choosers++);
    const image = { id: 'image', type: 'workflow', position: { x: 0, y: 0 }, data: { kind: 'image', title: '可引用图片', uploaded: true, status: 'ready', assetId: uuid() } };
    let graph = { version: 1, viewport: { x: 180, y: 120, zoom: 0.8 }, nodes: [image,
      { id: 'edit', type: 'workflow', position: { x: 750, y: 0 }, data: { kind: 'edit', title: '智能剪辑' } },
      ...Array.from({ length: 10 }, (_, i) => ({ id: `source${i}`, type: 'workflow', position: { x: 3000, y: i * 450 }, data: { kind: 'image', title: `引用图片${i}`, uploaded: true, status: 'ready', assetId: uuid() } })),
    ], edges: Array.from({ length: 10 }, (_, i) => ({ id: `edge${i}`, source: `source${i}`, target: 'edit' })) };
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let json = [];
      if (path === '/api/auth/me') json = { id: uuid(), name: 'Test' };
      else if (path === `/api/canvases/${id}`) {
        if (route.request().method() === 'PATCH') graph = route.request().postDataJSON().graph ?? graph;
        json = { id, name: 'Interactions', graph };
      } else if (path.startsWith('/api/assets/')) json = { id: path.split('/').at(-1), kind: 'image', status: 'ready', url: null };
      await route.fulfill({ json });
    });
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173'}/canvas/${id}`);
    const edit = page.locator('.react-flow__node[data-id="edit"]');
    const list = edit.locator('[data-node-scroll]');
    await expect(edit).toBeVisible();
    await expect(edit.getByRole('button', { name: '打开剪辑' })).toHaveCSS('cursor', 'pointer');
    await expect.poll(() => list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    const viewport = page.locator('.react-flow__viewport');
    const transform = await viewport.evaluate(el => el.style.transform);
    await list.hover();
    await page.mouse.wheel(0, 120);
    await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await viewport.evaluate(el => el.style.transform)).toBe(transform);
    await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(200);
    expect(await viewport.evaluate(el => el.style.transform)).toBe(transform);
    const source = page.locator('.react-flow__node[data-id="image"]');
    await edit.getByRole('button', { name: '添加剪辑素材' }).click();
    // Selection mode keeps the canvas and every global tool active.
    await expect(page.locator('.react-flow__background')).toHaveCSS('opacity', '1');
    await expect(page.locator('.react-flow__edge').first()).toHaveCSS('opacity', '1');
    await expect(page.getByLabel('画布名称')).toBeEditable();
    await expect(edit.getByLabel('智能剪辑名称')).toHaveCSS('cursor', 'not-allowed');
    const beforePan = await viewport.evaluate(el => el.style.transform);
    await page.mouse.move(1350, 950);
    await page.mouse.wheel(30, 20);
    await expect.poll(() => viewport.evaluate(el => el.style.transform)).not.toBe(beforePan);
    await expect(page.locator('.canvas-dependency-selecting')).toHaveCount(1);
    await page.waitForTimeout(250); // Let the wheel gesture finish before starting a drag.
    const beforeDrag = await viewport.evaluate(el => el.style.transform);
    await page.mouse.move(1350, 950);
    await page.mouse.down();
    await page.mouse.move(1390, 980, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => viewport.evaluate(el => el.style.transform)).not.toBe(beforeDrag);
    await expect(page.locator('.canvas-dependency-selecting')).toHaveCount(1);
    const beforeZoom = await viewport.evaluate(el => el.style.transform);
    await page.getByRole('button', { name: '缩小', exact: true }).click();
    await expect.poll(() => viewport.evaluate(el => el.style.transform)).not.toBe(beforeZoom);
    await expect(page.locator('.canvas-dependency-selecting')).toHaveCount(1);
    // Global sidebar tools remain available and may switch out of reference picking.
    await page.getByRole('button', { name: '添加节点', exact: true }).hover();
    await expect(page.locator('[data-add-node-menu]')).toBeVisible();
    await page.mouse.click(1350, 950);
    await edit.getByRole('button', { name: '添加剪辑素材' }).click();
    const title = source.locator('.workflow-node-title button');
    await expect(title).toHaveCSS('cursor', 'pointer');
    await expect(source.locator('.react-flow__handle').first()).toHaveCSS('cursor', 'pointer');
    await title.click();
    await expect(source.getByLabel('修改节点名称')).toHaveCount(0);
    await expect(page.locator('.react-flow__edge')).toHaveCount(11);
    await expect.poll(() => graph.edges.some(edge => edge.source === 'image' && edge.target === 'edit')).toBe(true);
    // Without selection mode the same title still performs its regular rename action.
    await source.click();
    await title.click();
    await expect(source.getByLabel('修改节点名称')).toBeVisible();
    await source.getByLabel('修改节点名称').press('Escape');
    expect(choosers).toBe(0);
    expect(errors).toEqual([]);
    console.log('PASS: smart edit list scrolling, boundary isolation, pointer cursors and selection intercepts internal controls');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
