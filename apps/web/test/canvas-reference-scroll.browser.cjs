const { chromium, expect } = require('@playwright/test');
const { randomUUID: uuid } = require('node:crypto');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const id = uuid();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let graph = { version: 1, viewport: { x: 200, y: 120, zoom: 0.8 }, nodes: [
      { id: 'target', type: 'workflow', position: { x: 0, y: 0 }, data: { kind: 'text', title: '目标', content: '' } },
      ...Array.from({ length: 10 }, (_, i) => ({ id: `ref${i}`, type: 'workflow', position: { x: 3000, y: i * 450 }, data: { kind: 'text', title: `参考素材长标题${i}`, content: `参考内容${i}` } })),
    ], edges: Array.from({ length: 10 }, (_, i) => ({ id: `edge${i}`, source: `ref${i}`, target: 'target' })) };
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let json = [];
      if (path === '/api/auth/me') json = { id: uuid(), name: 'Test' };
      else if (path === `/api/canvases/${id}`) {
        if (route.request().method() === 'PATCH') graph = route.request().postDataJSON().graph ?? graph;
        json = { id, name: 'Reference scrolling', graph };
      }
      await route.fulfill({ json });
    });
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173'}/canvas/${id}`);
    await page.locator('.react-flow__node[data-id="target"]').click();
    const list = page.locator('[data-prompt-reference-list]');
    await expect(list).toBeVisible();
    await expect.poll(() => list.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    const viewport = page.locator('.react-flow__viewport');
    const transform = await viewport.evaluate(el => el.style.transform);
    await list.hover();
    await page.mouse.wheel(180, 0);
    await expect.poll(() => list.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    expect(await viewport.evaluate(el => el.style.transform)).toBe(transform);
    await list.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await page.mouse.wheel(180, 0);
    await page.waitForTimeout(200);
    expect(await viewport.evaluate(el => el.style.transform)).toBe(transform);
    await page.mouse.wheel(-180, 0);
    await expect.poll(() => list.evaluate(el => el.scrollLeft < el.scrollWidth - el.clientWidth)).toBe(true);
    expect(errors).toEqual([]);
    console.log('PASS: prompt references scroll horizontally in both directions without moving canvas, including at boundaries');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
