const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const pending = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const canvasId = randomUUID();
    let graph = { version: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const history = [];
    await page.route('**/fixture.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="steelblue"/></svg>' }));
    await page.route('**/fixture.mp4', (route) => route.fulfill({ status: 204 }));
    await page.route('**/fixture.wav', (route) => route.fulfill({ status: 204 }));
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      let json = [];
      if (url.pathname === '/api/auth/me') json = { id: 'user', name: 'Test' };
      else if (url.pathname === `/api/canvases/${canvasId}`) {
        if (request.method() === 'PATCH') graph = request.postDataJSON().graph ?? graph;
        json = { id: canvasId, name: 'Upload states', graph };
      } else if (url.pathname === '/api/assets/canvas-upload') {
        return new Promise((resolve) => pending.push({ route, resolve, kind: url.searchParams.get('kind') }));
      } else if (url.pathname === '/api/assets/history') json = history;
      else if (url.pathname.startsWith('/api/assets/')) json = history.find((item) => item.id === url.pathname.split('/').at(-1));
      await route.fulfill({ json });
    });
    const base = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8899';
    await page.goto(`${base}/canvas/${canvasId}`);
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    async function finishUpload(failed = false) {
      await expect.poll(() => pending.length).toBe(1);
      const item = pending.shift();
      if (failed) await item.route.fulfill({ status: 503, json: { message: '网络连接中断，请重试上传' } });
      else {
        const asset = { id: randomUUID(), kind: item.kind, name: `ready.${item.kind}`, source: 'upload', status: 'ready', width: 160, height: 90,
          url: `/fixture.${item.kind === 'image' ? 'svg' : item.kind === 'video' ? 'mp4' : 'wav'}` };
        history.unshift(asset);
        await item.route.fulfill({ json: asset });
      }
      item.resolve();
    }
    for (const [index, kind] of ['image', 'video', 'audio'].entries()) {
      await page.getByLabel('上传画布素材').setInputFiles({ name: `file.${kind}`, mimeType: `${kind}/${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav'}`, buffer: Buffer.from('fixture') });
      await expect(page.locator('.react-flow__node')).toHaveCount(index + 1);
      const node = page.locator('.react-flow__node').filter({ has: page.locator('[data-upload-state="uploading"]') });
      await expect(node).toHaveCount(1);
      const id = await node.getAttribute('data-id');
      const card = page.locator(`.react-flow__node[data-id="${id}"]`);
      await expect(card.getByText('上传中', { exact: true })).toBeVisible();
      // The placeholder exists and is persisted before the response is released.
      await expect.poll(() => graph.nodes.find((item) => item.id === id)?.data.uploadState).toBe('uploading');
      await finishUpload(true);
      await expect(card.locator('[data-upload-state="failed"]')).toBeVisible();
      await expect(card.getByRole('alert')).toHaveText('网络连接中断，请重试上传');
      await expect(page.locator('[data-toast-type="error"]').last()).toContainText('网络连接中断，请重试上传');
      const retry = card.getByRole('button', { name: '重新上传', exact: true });
      await expect(retry).toHaveCSS('cursor', 'pointer');
      const background = await retry.evaluate((element) => getComputedStyle(element).backgroundColor);
      await retry.hover();
      await expect.poll(() => retry.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(background);
      const chooser = page.waitForEvent('filechooser');
      await retry.click();
      await (await chooser).setFiles({ name: `retry.${kind}`, mimeType: `${kind}/${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav'}`, buffer: Buffer.from('retry') });
      await expect(card.locator('[data-upload-state="uploading"]')).toBeVisible();
      await finishUpload();
      await expect(card.locator('[data-upload-state]')).toHaveCount(0);
      await expect(card.locator(kind === 'image' ? 'img' : kind)).toHaveCount(1);
      await expect.poll(() => graph.nodes.find((item) => item.id === id)?.data.status).toBe('ready');
      expect(graph.nodes).toHaveLength(index + 1);
    }
    // A saved in-flight upload becomes actionable after refresh.
    graph.nodes.push({ id: 'interrupted', position: { x: 600, y: 600 }, data: {
      kind: 'image', title: 'Interrupted', content: '', uploaded: true, uploadState: 'uploading', generationDetached: true,
    } });
    await page.reload();
    const interrupted = page.locator('.react-flow__node[data-id="interrupted"]');
    await expect(interrupted.locator('[data-upload-state="failed"]')).toBeVisible();
    await expect(interrupted.getByRole('alert')).toHaveText('上传已中断，请重新上传');
    await expect(interrupted.getByRole('button', { name: '重新上传', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    console.log('PASS: no default preview nodes; immediate placeholders; image/video/audio failures, toast, same-node retry, success, and interrupted-upload recovery');
  } finally {
    for (const item of pending) { await item.route.abort().catch(() => {}); item.resolve(); }
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
