const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const canvasId = randomUUID(), assetId = randomUUID();
    let generation;
    let graph = { version: 1, nodes: [
      { id: 'target', position: { x: 400, y: 120 }, data: { kind: 'image', title: 'Target', prompt: '', status: 'idle' } },
      { id: 'photo', position: { x: 1000, y: 120 }, data: { kind: 'image', title: 'Photo', url: '/photo.svg', assetId, status: 'ready', uploaded: true } },
      { id: 'second', position: { x: 1500, y: 120 }, data: { kind: 'image', title: 'Second', url: '/photo.svg', assetId: randomUUID(), status: 'ready', uploaded: true } },
      { id: 'video', position: { x: 1000, y: 650 }, data: { kind: 'video', title: 'Video', url: '/clip.mp4', status: 'ready', uploaded: true } },
    ], edges: [], viewport: { x: 0, y: 0, zoom: 0.7 } };
    await page.route('**/photo.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="blue"/></svg>' }));
    await page.route('**/clip.mp4', route => route.fulfill({ contentType: 'video/mp4', body: Buffer.from('fixture-video') }));
    await page.route('**/api/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      let json = [];
      if (pathname === '/api/auth/me') json = { id: 'user', name: 'Test' };
      else if (pathname.startsWith('/api/assets/')) {
        const node = graph.nodes.find(node => node.data.assetId === pathname.split('/').pop());
        json = { id: node?.data.assetId, kind: 'image', status: 'ready', url: '/photo.svg', width: 80, height: 80 };
      }
      else if (pathname === `/api/canvases/${canvasId}`) {
        if (request.method() === 'PATCH') graph = request.postDataJSON().graph ?? graph;
        json = { id: canvasId, name: 'Kolors test', graph };
      } else if (pathname === '/api/generation-tasks' && request.method() === 'POST') {
        generation = request.postDataJSON();
        json = { id: randomUUID(), requestId: generation.requestId, status: 'queued' };
      }
      await route.fulfill({ json });
    });
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8899'}/canvas/${canvasId}`);
    const target = page.locator('.react-flow__node[data-id="target"]');
    const input = page.locator('.react-flow__node-toolbar [role="textbox"]');
    await target.click();
    // CogView cannot cite images; choosing Kolors makes them available immediately.
    await input.fill('@Photo');
    await expect(page.getByRole('option', { name: /Photo/ })).toHaveCount(0);
    await input.fill('');
    await page.getByRole('button', { name: '选择图片生成模型', exact: true }).click();
    await page.getByRole('option', { name: /Kolors/ }).click();
    await input.fill('@Photo');
    await expect(page.getByRole('option', { name: /Photo/ })).toHaveCount(0);
    await input.fill('');
    await page.getByRole('button', { name: '选择图片生成设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '选择图片生成设置', exact: true });
    await expect(settings).not.toContainText('1024×1024');
    await expect(settings).not.toContainText('图片质量');
    await settings.getByRole('button', { name: '720 × 1280', exact: true }).click();
    await expect(page.getByRole('button', { name: '选择图片生成设置', exact: true })).toContainText('9:16');
    await input.click();
    // Both the dependency picker and inline reference use the same image input.
    await page.getByRole('button', { name: '添加参考节点', exact: true }).click();
    await page.locator('.react-flow__node[data-id="photo"]').click();
    await expect.poll(() => graph.edges.some(edge => edge.source === 'photo' && edge.target === 'target')).toBe(true);
    await target.click();
    await input.fill('水彩画 ');
    await input.press('End');
    await input.pressSequentially('@Photo');
    await page.getByRole('option', { name: /Photo/ }).click();
    await expect(input.locator('[data-node-id="photo"]')).toHaveCount(1);
    // Unsupported references remain visible and recover when switching back.
    const chip = input.locator('[data-node-id="photo"]');
    await page.getByRole('button', { name: '选择图片生成模型', exact: true }).click();
    await page.getByRole('option', { name: /CogView-3-Flash/ }).click();
    await expect(chip).toHaveAttribute('data-inactive-reference', 'true');
    await expect(chip).toHaveClass(/opacity-40/);
    await expect(chip.locator('span').last()).toHaveClass(/line-through/);
    await page.getByRole('button', { name: '选择图片生成模型', exact: true }).click();
    await page.getByRole('option', { name: /Kolors/ }).click();
    await expect(chip).not.toHaveAttribute('data-inactive-reference', 'true');
    // Clicking a wire reveals the cut button; cutting removes its dependency.
    const connection = page.locator('.react-flow__edge').first();
    const point = await connection.locator('.react-flow__edge-path').evaluate(path => {
      const p = path.getPointAtLength(path.getTotalLength() / 2);
      const result = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM());
      return { x: result.x, y: result.y };
    });
    await page.mouse.click(point.x, point.y);
    await page.getByRole('button', { name: '截断连接', exact: true }).click();
    await expect.poll(() => graph.edges.length).toBe(0);
    await target.click();
    await expect(chip).toHaveAttribute('data-inactive-reference', 'true');
    await page.getByRole('button', { name: '添加参考节点', exact: true }).click();
    await page.locator('.react-flow__node[data-id="photo"]').click();
    await target.click();
    await expect(chip).not.toHaveAttribute('data-inactive-reference', 'true');
    // Check both media node context menus and actual browser downloads.
    for (const [id, filename] of [['photo', 'Photo.svg'], ['video', 'Video.mp4']]) {
      await page.locator(`.react-flow__node[data-id="${id}"]`).click({ button: 'right' });
      const menu = page.locator('[data-node-action-menu]');
      await expect(menu.getByRole('button', { name: '下载', exact: true })).toBeEnabled();
      const labels = await menu.getByRole('button').allTextContents();
      expect(labels.at(-2).trim()).toBe('下载');
      expect(labels.at(-1).trim()).toBe('删除');
      const downloaded = page.waitForEvent('download');
      await menu.getByRole('button', { name: '下载', exact: true }).click();
      expect((await downloaded).suggestedFilename()).toBe(filename);
    }
    await target.click();
    await page.getByRole('button', { name: '选择图片生成设置', exact: true }).click();
    await settings.getByRole('button', { name: '720 × 1280', exact: true }).click();
    await input.click();
    await input.press('End');
    await input.pressSequentially(' @Second');
    await expect(page.getByRole('option', { name: /Second/ })).toHaveCount(0);
    // Remove the unfinished mention before submitting.
    for (let i = 0; i < 8; i++) await input.press('Backspace');
    await page.getByRole('button', { name: '生成图片', exact: true }).click();
    await expect.poll(() => generation?.model).toBe('Kwai-Kolors/Kolors');
    expect(generation.imageAssetIds).toEqual([assetId]);
    expect(generation.references).toEqual([expect.objectContaining({ kind: 'image', assetId })]);
    expect(generation.size).toBe('720x1280');
    expect(errors).toEqual([]);
    console.log('Canvas reference scope, model compatibility, connection cutting, image/video downloads and Kolors generation passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
