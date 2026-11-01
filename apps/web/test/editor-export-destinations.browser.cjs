const { chromium, expect } = require('@playwright/test');
const { randomUUID: uuid } = require('node:crypto');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const projectId = uuid(), canvasId = uuid(), standaloneId = uuid();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let latest = null;
    const requests = [];
    const timeline = { settings: { fps: 30, width: 1920, height: 1080 }, tracks: [], canvasSource: { canvasId, nodeId: 'edit', assets: [] } };
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let json = [];
      if (path === '/api/auth/me') json = { id: uuid(), name: 'Test' };
      else if (path === `/api/projects/${projectId}`) json = { id: projectId, name: '测试成片', timeline };
      else if (path === `/api/projects/${standaloneId}`) json = { id: standaloneId, name: '独立剪辑', timeline: { ...timeline, canvasSource: undefined } };
      else if (path === '/api/render' && route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        requests.push(body);
        latest = { id: uuid(), projectId, canvasId: body.canvasId, status: 'completed', stage: 'completed', progress: 100, outputUrl: 'https://example.test/video.mp4', fileName: '成片.mp4' };
        json = latest;
      } else if (path === '/api/render' || path.startsWith('/api/render/')) json = latest;
      await route.fulfill({ json });
    });
    const base = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
    await page.goto(`${base}/editor/${projectId}`);
    const button = page.getByRole('button', { name: '导出', exact: true });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.getByRole('menu', { name: '导出方式' })).toBeVisible();
    await page.getByRole('menuitem', { name: '导出到画布' }).click();
    await page.getByRole('button', { name: '开始导出', exact: true }).click();
    await expect(page.getByText('已导出到画布', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '返回画布查看' })).toHaveAttribute('href', `/canvas/${canvasId}`);
    expect(requests[0].canvasId).toBe(canvasId);
    await button.click();
    await page.getByRole('menuitem', { name: '导出到本地' }).click();
    await page.getByRole('button', { name: '开始导出', exact: true }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].canvasId).toBeUndefined();
    await expect(page.getByRole('link', { name: '或点此下载' })).toBeVisible();
    latest = null;
    await page.goto(`${base}/editor/${standaloneId}`);
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.getByRole('menu', { name: '导出方式' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '开始导出', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    console.log('PASS: canvas/local export branches, request destinations, completion actions, and standalone editor');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
