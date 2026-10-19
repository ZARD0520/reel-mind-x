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
    let submissions = 0;
    let graph = { version: 1, nodes: [
      { id: 'text', position: { x: 0, y: 100 }, data: { kind: 'text', title: 'Script', content: '音频文案', status: 'ready' } },
      { id: 'uploaded', position: { x: 1000, y: 100 }, data: { kind: 'audio', uploaded: true, title: 'Voice', content: '', url: '/audio.wav', status: 'ready' } },
      { id: 'video', position: { x: 1600, y: 100 }, data: { kind: 'video', title: 'Video', content: '' } },
    ], edges: [{ id: 'legacy-input', source: 'text', target: 'uploaded' }], viewport: { x: 100, y: 0, zoom: 0.55 } };
    await page.route('**/audio.wav', (route) => route.fulfill({ status: 204 }));
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      let json = [];
      if (pathname === '/api/auth/me') json = { id: 'user', name: 'Test' };
      else if (pathname === `/api/canvases/${canvasId}`) {
        if (request.method() === 'PATCH') graph = request.postDataJSON().graph ?? graph;
        json = { id: canvasId, name: 'Audio nodes', graph };
      } else if (pathname === '/api/generation-tasks' && request.method() === 'POST') submissions++;
      await route.fulfill({ json });
    });
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://localhost:5173'}/canvas/${canvasId}`);
    const node = (id) => page.locator(`.react-flow__node[data-id="${id}"]`);
    const input = page.locator('.react-flow__node-toolbar [role="textbox"]');
    await page.getByRole('button', { name: '添加节点', exact: true }).click();
    await page.getByRole('button', { name: /音频节点 添加音频素材/ }).click();
    await expect.poll(() => graph.nodes.length).toBe(4);
    const audioId = graph.nodes.find((item) => !['text', 'uploaded', 'video'].includes(item.id)).id;
    // Spread the persisted fixtures out so all handles can be reached independently.
    graph.nodes = graph.nodes.map((item) => item.id === audioId ? { ...item, position: { x: 500, y: 100 } } : item);
    await page.reload();
    await node(audioId).click({ position: { x: 70, y: 50 } });
    await expect(page.getByText('音频模型暂未接入', { exact: true })).toBeVisible();
    await input.fill('音频生成提示词');
    await input.press('Enter');
    await expect(page.getByRole('button', { name: '生成音频', exact: true })).toBeDisabled();
    await input.fill('@');
    await expect(page.getByRole('option', { name: /Voice|Video/ })).toHaveCount(0);
    await page.getByRole('option', { name: /Script/ }).click();
    await expect.poll(() => graph.edges.some((edge) => edge.source === 'text' && edge.target === audioId)).toBe(true);
    // Uploaded audio has output only, and legacy incoming edges are removed.
    await expect(node('uploaded').locator('.react-flow__handle.target')).toHaveCount(0);
    expect(graph.edges.some((edge) => edge.target === 'uploaded')).toBe(false);
    await node('uploaded').click({ position: { x: 70, y: 50 } });
    await expect(input).toHaveCount(0);
    // Uploaded audio can be referenced by video, including a real audio chip/preview.
    await node('video').click({ position: { x: 70, y: 50 } });
    await input.fill('@Voice');
    await page.getByRole('option', { name: /Voice/ }).click();
    await expect(input.locator('[data-reference-kind="audio"]')).toHaveCount(1);
    await expect.poll(() => graph.edges.some((edge) => edge.source === 'uploaded' && edge.target === 'video')).toBe(true);
    await input.locator('[data-node-id="uploaded"]').hover();
    await expect(page.getByRole('tooltip').locator('audio')).toHaveCount(1);
    await page.mouse.move(10, 10);
    // Audio generation is unavailable; video must not silently ignore audio either.
    await page.getByRole('button', { name: '生成视频', exact: true }).click();
    await expect(page.getByText('当前视频模型暂不支持音频参考，请移除音频引用后再试').first()).toBeVisible();
    expect(submissions).toBe(0);
    await page.reload();
    await expect(node('uploaded').locator('.react-flow__handle.target')).toHaveCount(0);
    await node(audioId).click({ position: { x: 70, y: 50 } });
    await expect(input.locator('[data-node-id="text"]')).toHaveCount(1);
    expect(graph.edges).toHaveLength(2);
    expect(errors).toEqual([]);
    console.log('PASS: create audio nodes, persist text/audio/video dependencies, preview uploaded audio, hide uploaded prompts, and never submit unsupported generation');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
