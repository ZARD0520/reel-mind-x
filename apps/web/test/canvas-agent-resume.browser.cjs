const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');
const { mergeCanvasGraphs } = createRequire(path.resolve(__dirname, '../../api/package.json'))('@reel/contracts');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const canvasId = randomUUID();
    const task = { id: randomUUID(), requestId: randomUUID(), nodeId: 'image', kind: 'image', model: 'cogview-3-flash', revision: 1, status: 'saving', canResume: false, error: null,
      items: [{ id: randomUUID(), index: 0, status: 'saving', canResume: false, asset: { id: randomUUID(), kind: 'image', status: 'generating', url: null } }] };
    let graph = { version: 1, nodes: [{ id: 'image', type: 'workflow', position: { x: 200, y: 120 }, data: { kind: 'image', title: '恢复图片', prompt: '小狗', content: '', status: 'generating', generationTaskId: task.id, generationRequestId: task.requestId } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const run = { id: randomUUID(), status: 'waiting_generation', backgroundPending: true, events: [], steps: [{ tool: 'generate_image', generationTaskId: task.id, generationRevision: 1 }] };
    const conversation = { id: randomUUID(), title: '恢复原任务', agentRuns: [run], messages: [{ id: randomUUID(), role: 'assistant', content: '正在保存图片', references: [] }] };
    let reads = 0, resumes = 0, unexpected = 0;
    await page.route('**/files/resume.png', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="blue"/></svg>' }));
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()); let json = [];
      if (url.pathname === '/api/auth/me') json = { id: 'owner', name: 'Test' };
      else if (url.pathname === `/api/canvases/${canvasId}`) {
        if (request.method() === 'PATCH') { const input = request.postDataJSON(); graph = mergeCanvasGraphs(input.baseGraph, input.graph, graph); }
        json = { id: canvasId, name: '恢复测试', graph };
      } else if (url.pathname.endsWith('/conversations')) json = [conversation];
      else if (url.pathname.endsWith(`/conversations/${conversation.id}`)) { reads++; json = conversation; }
      else if (url.pathname === `/api/generation-tasks/${task.id}/resume`) {
        resumes++; task.revision = 3; task.status = task.items[0].status = 'saving'; task.items[0].asset.status = 'generating'; task.canResume = false; task.error = null; json = task;
      } else if (url.pathname === '/api/generation-tasks') { if (request.method() === 'POST') unexpected++; json = [task]; }
      else if (url.pathname.endsWith('/messages') && request.method() === 'POST') unexpected++;
      await route.fulfill({ json });
    });
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173'}/canvas/${canvasId}`);
    const image = page.locator('.react-flow__node[data-id="image"]');
    await expect(image.getByText('生成中', { exact: true })).toBeVisible();
    task.revision = 2; task.status = task.items[0].status = 'failed'; task.items[0].asset.status = 'failed'; task.canResume = true; task.error = '保存失败';
    run.status = 'completed_with_errors'; run.backgroundPending = false; run.steps[0].generationRevision = 2;
    conversation.messages[0].content = '1 张失败，可重试保存';
    await expect(image.getByRole('button', { name: '重试保存', exact: true })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: '打开 Agent Chat', exact: true }).click();
    await expect(page.locator('aside[aria-hidden="false"]')).toContainText('1 张失败，可重试保存');
    await image.getByRole('button', { name: '重试保存', exact: true }).click();
    await expect(image.getByText('生成中', { exact: true })).toBeVisible();
    const before = reads;
    await expect.poll(() => reads, { timeout: 10000 }).toBeGreaterThan(before);
    // The task finishes before the Agent scanner has updated the old terminal
    // run. Chat must continue observing the version mismatch until it catches up.
    task.revision = 4; task.status = task.items[0].status = 'completed'; task.items[0].asset.status = 'ready'; task.items[0].asset.url = '/files/resume.png';
    await expect(image.locator('img').first()).toHaveAttribute('src', '/files/resume.png', { timeout: 10000 });
    const completedBeforeReceipt = reads;
    await expect.poll(() => reads, { timeout: 10000 }).toBeGreaterThan(completedBeforeReceipt);
    run.status = 'completed'; run.steps[0].generationRevision = 4; conversation.messages[0].content = '图片生成完成：1 张成功。';
    await expect(page.locator('aside[aria-hidden="false"]')).toContainText('图片生成完成：1 张成功。', { timeout: 10000 });
    expect(resumes).toBe(1); expect(unexpected).toBe(0); expect(errors).toEqual([]);
    console.log('PASS: retry saving updates the original Agent reply, observes fast completion before receipt refresh, and does not submit generation or chat again');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
