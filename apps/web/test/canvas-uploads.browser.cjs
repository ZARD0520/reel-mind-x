const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    page.setDefaultTimeout(12000);
    const canvasId = randomUUID();
    let graph = { version: 1, nodes: [{ id: 'empty', position: { x: 0, y: 0 }, data: { kind: 'image', title: '空图片', content: '' } }], edges: [], viewport: { x: 200, y: 100, zoom: 0.7 } };
    const assets = new Map();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      let json = [];
      if (url.pathname === '/api/auth/me') json = { id: 'user', name: '测试' };
      else if (url.pathname === `/api/canvases/${canvasId}`) {
        if (request.method() === 'PATCH') graph = request.postDataJSON().graph ?? graph;
        json = { id: canvasId, name: '上传测试', graph };
      } else if (url.pathname === '/api/assets/canvas-upload') {
        const kind = url.searchParams.get('kind');
        json = { id: randomUUID(), kind, name: `测试.${kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav'}`, source: 'upload', status: 'ready', url: '/test-media', width: 640, height: 360 };
        assets.set(json.id, json);
      } else if (url.pathname.startsWith('/api/assets/')) json = assets.get(url.pathname.split('/').pop()) ?? [];
      await route.fulfill({ json });
    });
    const base = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
    await page.goto(`${base}/canvas/${canvasId}`);
    await expect(page.locator('.react-flow__node').getByRole('button', { name: '上传', exact: true })).toHaveCount(0);
    await expect(page.locator('.react-flow__node').getByRole('button', { name: '资产库', exact: true })).toHaveCount(0);
    for (const [kind, extension] of [['image', 'png'], ['video', 'mp4'], ['audio', 'wav']]) {
      await page.getByRole('button', { name: '添加节点', exact: true }).click();
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: /^上传 支持图片、视频和音频/ }).click();
      await (await chooser).setFiles({ name: `测试.${extension}`, mimeType: `${kind}/${extension}`, buffer: Buffer.from('mock media') });
      await expect.poll(() => graph.nodes.some((node) => node.data.title === `测试.${extension}` && node.data.uploaded)).toBe(true);
      const uploaded = graph.nodes.find((node) => node.data.title === `测试.${extension}`);
      const node = page.locator(`.react-flow__node[data-id="${uploaded.id}"]`);
      await node.click({ position: { x: 20, y: 10 } });
      await expect(page.locator('.react-flow__node-toolbar form')).toHaveCount(0);
      await expect(node.locator(kind === 'image' ? 'img' : kind)).toHaveCount(1);
    }
    graph = { ...graph, nodes: graph.nodes.map((node, index) => ({ ...node, position: { x: index * 850, y: 0 } })), viewport: { x: 30, y: 100, zoom: 0.4 } };
    await page.reload();
    await expect(page.locator('.react-flow__node audio')).toHaveCount(1);
    for (const node of graph.nodes.filter((item) => item.data.uploaded)) {
      const element = page.locator(`.react-flow__node[data-id="${node.id}"]`);
      await element.click({ position: { x: 20, y: 10 } });
      await expect(page.locator('.react-flow__node-toolbar form')).toHaveCount(0);
      await expect(element.locator('.react-flow__handle.target')).toHaveCount(0);
      await expect(element.locator('.react-flow__handle.source')).toHaveCount(2);
      await element.dblclick({ position: { x: 70, y: 35 } });
      await expect(page.locator('[data-node-action-menu]')).toHaveCount(0);
      await element.click({ button: 'right', position: { x: 70, y: 35 } });
      await expect(page.locator('[data-node-action-menu]')).toBeVisible();
      await page.locator('.react-flow__pane').click({ position: { x: 250, y: 600 } });
      await element.hover({ position: { x: 70, y: 35 } });
      const replace = element.getByRole('button', { name: '替换素材', exact: true });
      await expect(replace).toHaveCSS('opacity', '1');
      const before = assets.size;
      // A mismatched type must never reach the upload endpoint.
      await element.getByLabel('替换节点素材').setInputFiles({ name: 'wrong.txt', mimeType: 'text/plain', buffer: Buffer.from('wrong type') });
      await expect(page.getByText(/替换素材必须为同一类型/).last()).toBeVisible();
      expect(assets.size).toBe(before);
      const chooser = page.waitForEvent('filechooser');
      await replace.click();
      const extension = node.data.kind === 'image' ? 'png' : node.data.kind === 'video' ? 'mp4' : 'wav';
      await (await chooser).setFiles({ name: `替换.${extension}`, mimeType: `${node.data.kind}/${extension}`, buffer: Buffer.from('replacement') });
      await expect.poll(() => graph.nodes.find((item) => item.id === node.id)?.data.assetId).not.toBe(node.data.assetId);
      expect(graph.nodes).toHaveLength(4);
      await expect(page.locator('.react-flow__node-toolbar form')).toHaveCount(0);
    }
    const uploadCount = assets.size;
    await page.getByLabel('上传画布素材').evaluate((input) => {
      const file = new File(['small placeholder'], 'too-large.mp4', { type: 'video/mp4' });
      Object.defineProperty(file, 'size', { value: 500 * 1024 * 1024 + 1 });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.getByText('文件大小不能超过 500MB', { exact: true })).toBeVisible();
    expect(assets.size).toBe(uploadCount);
    expect(errors).toEqual([]);
    console.log('PASS: toolbar uploads image/video/audio, persists nodes, blocks oversized uploads; uploaded nodes have no input handles or prompts, right-click menus and same-type replacement work');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
