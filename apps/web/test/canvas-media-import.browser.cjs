const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const canvasId = randomUUID();
    let graph = { version: 1, nodes: ['image', 'video', 'image', 'video'].map((kind, index) => ({
      id: `node-${index}`, position: { x: 100 + index * 750, y: 160 },
      data: { kind, title: `Target ${index}`, prompt: `keep prompt ${index}`, content: '', status: 'idle' },
    })), edges: [], viewport: { x: 0, y: 0, zoom: 0.45 } };
    const uploads = [];
    const history = [];
    const folderId = randomUUID();
    const assets = ['image', 'video'].map((kind) => ({
      id: randomUUID(), kind, name: `Library ${kind}`, status: 'ready', source: 'upload', folderId,
      url: kind === 'image' ? '/fixture.svg' : '/fixture.mp4', width: 160, height: 90, durationInFrames: kind === 'video' ? 90 : null,
    }));
    await page.route('**/fixture.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="blue"/></svg>' }));
    await page.route('**/fixture.mp4', (route) => route.fulfill({ status: 204 }));
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      let json = [];
      if (url.pathname === '/api/auth/me') json = { id: 'user', name: 'Test' };
      else if (url.pathname === `/api/canvases/${canvasId}`) {
        if (request.method() === 'PATCH') graph = request.postDataJSON().graph ?? graph;
        json = { id: canvasId, name: 'Media import', graph };
      } else if (url.pathname === '/api/assets/canvas-upload') {
        expect(url.searchParams.get('canvasId')).toBe(canvasId);
        const kind = url.searchParams.get('kind');
        expect(request.headers()['content-type']).toContain('multipart/form-data');
        const asset = { ...assets.find((asset) => asset.kind === kind), id: randomUUID(), name: `Uploaded ${kind}`, canvasId, folderId: null };
        uploads.push({ kind, asset });
        history.unshift(asset);
        json = asset;
      } else if (url.pathname === '/api/assets/history') json = history;
      else if (url.pathname === '/api/asset-folders') json = [{ id: folderId, name: 'Fixtures', parentId: null, scope: 'personal' }];
      else if (url.pathname === '/api/asset-folders/search') json = assets.map((asset) => ({ ...asset, folderPath: [{ id: folderId, name: 'Fixtures' }] }));
      else if (url.pathname === `/api/asset-folders/${folderId}/assets`) json = assets;
      else if (url.pathname.startsWith('/api/assets/')) json = [...assets, ...history].find((asset) => asset.id === url.pathname.split('/').at(-1));
      await route.fulfill({ json });
    });
    const node = (index) => page.locator(`.react-flow__node[data-id="node-${index}"]`);
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8899'}/canvas/${canvasId}`);
    for (const index of [0, 1]) {
      const kind = index === 0 ? 'image' : 'video';
      const uploadButton = node(index).getByRole('button', { name: '\u4e0a\u4f20', exact: true });
      expect(await uploadButton.evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer');
      const background = await uploadButton.evaluate((element) => getComputedStyle(element).backgroundColor);
      await uploadButton.hover();
      await expect.poll(() => uploadButton.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(background);
      const chooser = page.waitForEvent('filechooser');
      await uploadButton.click();
      await (await chooser).setFiles({ name: `test.${kind === 'image' ? 'png' : 'mp4'}`, mimeType: kind === 'image' ? 'image/png' : 'video/mp4', buffer: Buffer.from('fixture') });
      await expect(node(index).locator(kind === 'image' ? 'img' : 'video')).toHaveAttribute('src', kind === 'image' ? '/fixture.svg' : '/fixture.mp4');
      await expect(node(index).getByRole('button', { name: '\u4e0a\u4f20', exact: true })).toHaveCount(0);
      await expect.poll(() => graph.nodes[index].data.assetId).toBe(uploads[index].asset.id);
      expect(graph.nodes[index].data.prompt).toBe(`keep prompt ${index}`);
      expect(graph.nodes[index].data.generationDetached).toBe(true);
    }
    for (const index of [2, 3]) {
      const kind = index === 2 ? 'image' : 'video';
      await node(index).getByRole('button', { name: '\u8d44\u4ea7\u5e93', exact: true }).click();
      const library = page.getByRole('dialog', { name: '\u8d44\u4ea7\u5e93', exact: true });
      await library.getByRole('textbox', { name: '\u641c\u7d22\u7d20\u6750\u540d\u79f0' }).fill('Library');
      const matching = library.getByRole('button', { name: `\u6dfb\u52a0 Library ${kind} \u5230\u753b\u5e03`, exact: true });
      await expect(matching).toBeVisible();
      await expect(library.getByRole('button', { name: `\u6dfb\u52a0 Library ${kind === 'image' ? 'video' : 'image'} \u5230\u753b\u5e03`, exact: true })).toHaveCount(0);
      await matching.click();
      await expect(library).toHaveCount(0);
      await expect.poll(() => graph.nodes[index].data.assetId).toBe(assets.find((asset) => asset.kind === kind).id);
      expect(graph.nodes).toHaveLength(4);
      expect(graph.nodes[index].data.prompt).toBe(`keep prompt ${index}`);
    }
    await page.reload();
    for (const index of [0, 1, 2, 3]) await expect(node(index).locator(index % 2 ? 'video' : 'img')).toBeVisible();
    await page.getByRole('button', { name: '\u5386\u53f2', exact: true }).click();
    const historyDialog = page.getByRole('dialog', { name: '\u5386\u53f2', exact: true });
    await expect(historyDialog.getByText('Uploaded image', { exact: true })).toBeVisible();
    await expect(historyDialog.getByText('Uploaded video', { exact: true })).toBeVisible();
    expect(uploads.map((upload) => upload.kind)).toEqual(['image', 'video']);
    expect(errors).toEqual([]);
    console.log('PASS: empty media actions, hover/pointer, image/video upload, scoped history, typed library fill, prompt preservation and reload');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
