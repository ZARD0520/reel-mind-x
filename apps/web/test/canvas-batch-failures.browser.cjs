const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const canvasId = randomUUID();
    const task = {
      id: randomUUID(), requestId: randomUUID(), nodeId: 'parent', kind: 'image',
      model: 'cogview-3-flash', status: 'generating', error: null, canResume: false,
      items: Array.from({ length: 4 }, (_, index) => ({
        id: randomUUID(), index, status: 'generating', error: null, canResume: false,
        asset: { id: randomUUID(), kind: 'image', status: 'generating', url: null },
      })),
    };
    let graph = { version: 1, nodes: [{ id: 'parent', position: { x: 100, y: 100 }, data: {
      kind: 'image', title: '测试图片', content: '', prompt: '测试提示词', status: 'generating',
      generationCount: 4, generationTaskId: task.id, aspectRatio: '16:9',
    } }], edges: [], viewport: { x: 0, y: 0, zoom: 0.65 } };
    let submissions = 0;
    await page.route('**/batch-image.svg', (route) => route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="blue"/></svg>',
    }));
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      let json = [];
      if (pathname === '/api/auth/me') json = { id: 'user', name: '测试用户' };
      else if (pathname === `/api/canvases/${canvasId}`) {
        if (request.method() === 'PATCH') graph = request.postDataJSON().graph ?? graph;
        json = { id: canvasId, name: '批量失败节点测试', graph };
      } else if (pathname === '/api/generation-tasks') {
        if (request.method() === 'POST') throw new Error(`Unexpected generation ${++submissions}`);
        json = [task];
      }
      await route.fulfill({ json });
    });
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://localhost:5173'}/canvas/${canvasId}`);
    await expect(page.getByText('生成中', { exact: true })).toBeVisible();
    task.status = 'failed';
    task.error = '模型繁忙，请更换模型或稍后再试';
    task.items.forEach((item, index) => {
      item.status = index % 2 ? 'completed' : 'failed';
      item.error = index % 2 ? null : task.error;
      item.asset.status = index % 2 ? 'ready' : 'failed';
      item.asset.url = index % 2 ? '/batch-image.svg' : null;
    });
    await expect(page.locator('.react-flow__node')).toHaveCount(4);
    await expect(page.locator('.react-flow__node [data-generation-error] [role="alert"]')).toHaveCount(2);
    await expect.poll(() => graph.nodes.length).toBe(4);
    if (graph.nodes.filter((node) => node.data.status === 'failed').length !== 2)
      throw new Error('Failed outputs were not persisted');
    await page.getByRole('button', { name: '适应画布', exact: true }).click();
    const failedId = task.items[0].asset.id;
    const failedNode = page.locator(`.react-flow__node[data-id="${failedId}"]`);
    await expect(failedNode.getByRole('alert')).toHaveText(task.error);
    await failedNode.click({ button: 'right' });
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await expect(failedNode).toHaveCount(0);
    await expect.poll(() => graph.nodes.length).toBe(3);
    await page.reload();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await expect(failedNode).toHaveCount(0);
    await expect(page.locator('.react-flow__node [role="alert"]')).toHaveCount(0);
    await expect(page.locator('[data-toast-type="error"]')).toHaveCount(0);
    if (submissions || errors.length) throw new Error(errors.join('\n') || 'Generation was repeated');
    console.log('PASS: mixed four-image batch keeps two failed nodes; deletion persists across reload without replaying errors or generating again');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
