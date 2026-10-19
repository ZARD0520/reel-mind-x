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
    const kinds = ['text', 'image', 'video'];
    let graph = { version: 1,
      nodes: kinds.map((kind, index) => ({ id: kind,
        position: { x: 100 + index * 550, y: 120 },
        data: { kind, title: `测试${kind}`, content: '', prompt: '', status: 'idle' },
      })), edges: [], viewport: { x: 0, y: 0, zoom: 0.65 },
    };
    let submissions = 0;
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      let json = [];
      if (pathname === '/api/auth/me') json = { id: 'user', name: '测试用户' };
      else if (pathname === `/api/canvases/${canvasId}`) {
        if (request.method() === 'PATCH') graph = request.postDataJSON().graph ?? graph;
        json = { id: canvasId, name: '提示词草稿测试', graph };
      } else if (pathname === '/api/generation-tasks' && request.method() === 'POST') {
        submissions++;
      }
      await route.fulfill({ json });
    });
    const node = (kind) => page.locator(`.react-flow__node[data-id="${kind}"]`);
    const input = () => page.locator('.react-flow__node-toolbar form [role="textbox"]');
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://localhost:5173'}/canvas/${canvasId}`);
    const drafts = { text: '文案提示词草稿\n第二行', image: '图片提示词草稿', video: '视频提示词草稿' };
    for (const kind of kinds) {
      await node(kind).click();
      await input(kind).fill(drafts[kind]);
    }
    for (const kind of kinds) {
      await node(kind).click();
      await expect(input(kind)).toHaveText(drafts[kind]);
    }
    await expect.poll(() => graph.nodes.map((item) => item.data.prompt)).toEqual(kinds.map((kind) => drafts[kind]));
    await page.reload();
    for (const kind of kinds) {
      await node(kind).click();
      await expect(input(kind)).toHaveText(drafts[kind]);
    }
    // Clearing is also a persisted edit; switching must not restore an older prompt.
    await node('image').click();
    await input('image').fill('');
    await node('video').click();
    await node('image').click();
    await expect(input('image')).toHaveText('');
    await expect.poll(() => graph.nodes.find((item) => item.id === 'image').data.prompt).toBe('');
    await page.reload();
    await node('image').click();
    await expect(input('image')).toHaveText('');
    if (submissions || errors.length) throw new Error(errors.join('\n') || 'Unexpected generation request');
    console.log('PASS: text/image/video prompt drafts survive switching and reload; cleared drafts remain empty; no generation is submitted');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
