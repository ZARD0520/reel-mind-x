const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const id = randomUUID();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let graph = { version: 1, viewport: { x: 200, y: 200, zoom: 1 }, edges: [], nodes: [
      { id: 'a', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'First', content: 'first text', status: 'ready' } },
      { id: 'b', position: { x: 450, y: 0 }, data: { kind: 'text', title: 'Second', content: 'second text', status: 'ready' } },
    ] };
    let saved = 0;
    await page.route('**/api/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      let json = [];
      if (pathname === '/api/auth/me') json = { id: 'user', name: 'Test' };
      else if (pathname === `/api/canvases/${id}`) {
        if (route.request().method() === 'PATCH') graph = route.request().postDataJSON().graph ?? graph;
        json = { id, name: 'Selection', graph };
      } else if (pathname === '/api/asset-folders') json = [{ id: 'folder', name: '测试文件夹', parentId: null, scope: 'personal' }];
      else if (route.request().method() === 'POST' && pathname.includes('asset-folders')) { saved++; json = { id: `saved-${saved}` }; }
      await route.fulfill({ json });
    });
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://localhost:5173'}/canvas/${id}`);
    const first = page.locator('.react-flow__node[data-id="a"]');
    await expect(first).toBeVisible();
    const a = await first.boundingBox();
    const b = await page.locator('.react-flow__node[data-id="b"]').boundingBox();
    // A single boxed node retains its normal selection, without group UI.
    await page.mouse.move(a.x - 30, a.y + 70);
    await page.mouse.down();
    await page.mouse.move(a.x + 60, a.y + 180, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(1);
    await expect(page.locator('[data-selection-background]')).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: '框选工具栏' })).toHaveCount(0);
    // Intersect both nodes without fully enclosing either one.
    await page.mouse.move(a.x - 30, a.y + 70);
    await page.mouse.down();
    await page.mouse.move(b.x + 60, a.y + 180, { steps: 15 });
    await expect(page.locator('.react-flow__selection')).toHaveCSS('border-radius', '24px');
    await expect(page.locator('.react-flow__selection')).toHaveCSS('border-top-color', 'rgba(255, 255, 255, 0.5)');
    await page.mouse.up();
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(2);
    await expect(page.locator('[data-selection-background]')).toBeVisible();
    await expect(page.locator('[data-selection-background]')).toHaveCSS('border-radius', '24px');
    await expect(page.locator('[data-selection-background]')).toHaveCSS('border-top-color', /^(rgba\(255, 255, 255, 0\.5\)|oklab\(0\.999994 .* \/ 0\.5\))$/);
    await expect(first.locator('.rounded-\\[24px\\]')).toHaveCSS('border-top-color', 'rgb(255, 255, 255)');
    const toolbar = page.getByRole('toolbar', { name: '框选工具栏' });
    await expect(toolbar).toBeVisible();
    const background = await page.locator('[data-selection-background]').boundingBox();
    const tools = await toolbar.boundingBox();
    expect(Math.abs(background.y - tools.y - tools.height - 10)).toBeLessThan(1);
    const nativeSelection = page.locator('.react-flow__nodesselection-rect');
    await expect(nativeSelection).toHaveCSS('border-top-width', '0px');
    await expect(nativeSelection).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await toolbar.getByRole('button', { name: '复制', exact: true }).hover();
    await expect(toolbar.getByRole('tooltip', { name: '复制', exact: true })).toBeVisible();
    await toolbar.getByRole('button', { name: '添加到资产库' }).click();
    await page.getByText('测试文件夹', { exact: true }).click();
    await page.getByRole('button', { name: /保存到此文件夹|保存/ }).last().click();
    await expect.poll(() => saved).toBe(2);
    await expect(page.getByRole('dialog', { name: '保存到资产库' })).toHaveCount(0);
    const download = page.waitForEvent('download');
    await toolbar.getByRole('button', { name: '下载', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('First.txt');
    await toolbar.getByRole('button', { name: '复制', exact: true }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(4);
    await page.mouse.dblclick(1200, 760);
    await expect(page.locator('[data-add-node-menu]')).toBeVisible();
    await page.getByRole('button', { name: /音频节点 添加音频素材/ }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(5);
    await page.getByRole('button', { name: '缩小', exact: true }).click();
    const zoomReset = page.getByRole('button', { name: '恢复100%缩放', exact: true });
    await expect(zoomReset).not.toHaveText('100%');
    await zoomReset.click();
    await expect(zoomReset).toHaveText('100%');
    expect(errors).toEqual([]);
    console.log('PASS: partial box selection, toolbar, batch save/download/copy, and double-click add menu');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
