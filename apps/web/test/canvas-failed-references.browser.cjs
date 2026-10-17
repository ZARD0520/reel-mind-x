const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const canvasId = randomUUID();
    const taskId = randomUUID();
    const imageId = randomUUID();
    const resultId = randomUUID();
    const baseGraph = {
      version: 1,
      nodes: [
        {
          id: 'video',
          position: { x: 400, y: 100 },
          data: {
            kind: 'video',
            title: '视频目标',
            content: '',
            prompt: '测试视频',
            referenceNodeIds: ['text', 'image'],
            aspectRatio: '16:9',
            status: 'generating',
            generationTaskId: taskId,
            assetId: resultId,
          },
        },
        {
          id: 'text',
          position: { x: 1600, y: 100 },
          data: { kind: 'text', title: '参考文字', content: '参考文案' },
        },
        {
          id: 'image',
          position: { x: 2100, y: 100 },
          data: {
            kind: 'image',
            title: '参考图片',
            content: '',
            url: '/reference-image.svg',
            assetId: imageId,
            status: 'ready',
            aspectRatio: '16:9',
          },
        },
      ],
      edges: [
        { id: 'text-edge', source: 'text', target: 'video' },
        { id: 'image-edge', source: 'image', target: 'video' },
      ],
      viewport: { x: 10, y: 10, zoom: 0.65 },
    };
    let graph = structuredClone(baseGraph);
    let task = {
      id: taskId,
      requestId: randomUUID(),
      nodeId: 'video',
      kind: 'video',
      model: 'cogvideox-flash',
      status: 'generating',
      error: null,
      canResume: false,
      createdAt: new Date().toISOString(),
      items: [
        {
          id: randomUUID(),
          index: 0,
          status: 'generating',
          providerTaskId: 'original-id',
          attemptCount: 1,
          nextRunAt: new Date().toISOString(),
          error: null,
          canResume: false,
          asset: { id: resultId, kind: 'video', status: 'generating', url: null },
        },
      ],
    };
    let payload;
    await page.route('**/reference-image.svg', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="blue"/></svg>',
      }),
    );
    await page.route('**/api/**', async (route) => {
      const req = route.request();
      const pathname = new URL(req.url()).pathname;
      let json = [];
      if (pathname === '/api/auth/me') json = { id: 'user', name: '测试用户' };
      else if (pathname === `/api/canvases/${canvasId}`) {
        if (req.method() === 'PATCH') graph = req.postDataJSON().graph ?? graph;
        json = { id: canvasId, name: '失败引用验证', graph };
      } else if (pathname === '/api/generation-tasks') {
        if (req.method() === 'POST') {
          payload = req.postDataJSON();
          task = {
            ...task,
            id: randomUUID(),
            requestId: payload.requestId,
            status: 'queued',
            error: null,
            items: task.items.map((item) => ({
              ...item,
              status: 'queued',
              asset: { ...item.asset, status: 'generating' },
            })),
          };
          json = task;
        } else json = [task];
      } else if (pathname === `/api/assets/${imageId}`)
        json = { id: imageId, kind: 'image', status: 'ready', url: '/reference-image.svg' };
      await route.fulfill({ json });
    });
    const base = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
    await page.goto(`${base}/canvas/${canvasId}`);
    const video = page.locator('.react-flow__node[data-id="video"]');
    await expect(video.getByText('生成中', { exact: true })).toBeVisible();
    task.status = 'failed';
    task.error = '模型繁忙，请更换模型或稍后再试';
    task.items[0].status = 'failed';
    task.items[0].asset.status = 'failed';
    await expect(video.getByRole('alert')).toHaveText(task.error);
    await video.click();
    const form = page.locator('.react-flow__node-toolbar form');
    await expect(form).toBeVisible();
    await expect(form.getByRole('button', { name: '生成视频', exact: true })).toBeEnabled();
    const promptInput = form.getByPlaceholder('描述你想生成的视频...');
    const imageReference = form.getByRole('button', {
      name: '移除提示词引用 参考图片',
      exact: true,
    });
    await promptInput.focus();
    await promptInput.evaluate((element) => element.setSelectionRange(0, 0));
    await promptInput.press('Backspace');
    await expect(imageReference).toHaveCount(0);
    await expect(promptInput).toHaveValue('测试视频');
    await expect(
      form.getByRole('button', { name: '移除提示词引用 参考文字', exact: true }),
    ).toBeVisible();
    await form.locator('[role="button"]').filter({ hasText: '参考图片' }).click();
    await promptInput.focus();
    await promptInput.evaluate((element) =>
      element.setSelectionRange(element.value.length, element.value.length),
    );
    await promptInput.press('Backspace');
    await expect(promptInput).toHaveValue('测试视');
    await expect(imageReference).toBeVisible();
    await promptInput.evaluate((element) => element.setSelectionRange(0, 2));
    await promptInput.press('Backspace');
    await expect(promptInput).toHaveValue('视');
    await expect(imageReference).toBeVisible();
    await promptInput.fill('测试视频');
    await promptInput.evaluate((element) => element.setSelectionRange(0, 0));
    await promptInput.dispatchEvent('keydown', {
      key: 'Backspace',
      code: 'Backspace',
      isComposing: true,
    });
    await expect(imageReference).toBeVisible();
    console.log(
      'PASS: failed node Backspace removes a reference at the text boundary, preserves text/selection editing and ignores IME composition',
    );
    await form.getByRole('button', { name: '删除依赖 参考文字', exact: true }).click();
    await expect(form.locator('span.truncate').filter({ hasText: /^参考文字$/ })).toHaveCount(0);
    await expect
      .poll(() => graph.nodes.find((node) => node.id === 'video').data.referenceNodeIds)
      .toEqual(['image']);
    console.log('PASS: failed node can delete a graph dependency');
    await form.getByRole('button', { name: '移除提示词引用 参考图片', exact: true }).click();
    await expect(form.locator('span.truncate').filter({ hasText: /^参考图片$/ })).toHaveCount(1);
    await expect
      .poll(() => graph.nodes.find((node) => node.id === 'video').data.referenceNodeIds)
      .toEqual([]);
    if (!graph.edges.some((edge) => edge.id === 'image-edge'))
      throw new Error('Removing an input reference deleted its graph dependency');
    await form.locator('[role="button"]').filter({ hasText: '参考图片' }).click();
    const inlineRemoval = form.getByRole('button', {
      name: '移除提示词引用 参考图片',
      exact: true,
    });
    await expect(inlineRemoval).toBeVisible();
    await inlineRemoval.press('Delete');
    await expect(inlineRemoval).toHaveCount(0);
    await expect(video).toBeVisible();
    await form.locator('[role="button"]').filter({ hasText: '参考图片' }).click();
    await promptInput.fill('');
    await promptInput.press('Backspace');
    await expect(inlineRemoval).toHaveCount(0);
    await expect(video).toBeVisible();
    await promptInput.fill('测试视频');
    await expect
      .poll(() => graph.nodes.find((node) => node.id === 'video').data.referenceNodeIds)
      .toEqual([]);
    await page.reload();
    await video.click();
    await expect(form.locator('span.truncate').filter({ hasText: /^参考图片$/ })).toHaveCount(1);
    await form.getByRole('button', { name: '生成视频', exact: true }).click();
    await expect.poll(() => !!payload).toBe(true);
    if (
      payload.references.length ||
      payload.imageAssetIds.length ||
      payload.prompt.includes('参考文案')
    )
      throw new Error('Regeneration retained deleted references');
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(
      'PASS: failed video input references are removable, persist after reload, and are excluded from regeneration',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
