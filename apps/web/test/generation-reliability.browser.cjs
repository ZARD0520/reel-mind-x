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
    const originalGraph = {
      version: 1,
      nodes: [
        {
          id: 'reference',
          position: { x: 750, y: 100 },
          data: { kind: 'text', title: '参考文本', content: '引用文本内容' },
        },
        {
          id: 'text',
          position: { x: 150, y: 100 },
          data: {
            kind: 'text',
            title: '生成文本',
            content: '',
            prompt: '写一段测试文案',
            model: 'glm-4-flash',
            generationCount: 2,
            referenceNodeIds: ['reference'],
          },
        },
      ],
      edges: [{ id: 'ref-edge', source: 'reference', target: 'text' }],
      viewport: { x: 10, y: 0, zoom: 0.7 },
    };
    let graph = structuredClone(originalGraph);
    let task;
    let posts = 0;
    let taskReads = 0;
    let resumes = 0;
    let payload;
    const makeAsset = (index, status = 'generating') => ({
      id: randomUUID(),
      kind: 'text',
      source: 'ai',
      status,
      name: `文案${index}`,
      content: status === 'ready' ? `生成结果${index}` : null,
      model: 'glm-4-flash',
      prompt: '写一段测试文案',
      references: [],
      url: null,
    });
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      let json = [];
      if (pathname === '/api/auth/me') json = { id: 'user', name: '测试用户' };
      else if (pathname === `/api/canvases/${canvasId}`) {
        if (request.method() === 'PATCH') graph = request.postDataJSON().graph ?? graph;
        json = { id: canvasId, name: '生成可靠性验证', graph };
      } else if (pathname === '/api/generation-tasks') {
        if (request.method() === 'POST') {
          posts++;
          payload = request.postDataJSON();
          task = {
            id: randomUUID(),
            requestId: payload.requestId,
            nodeId: payload.nodeId,
            kind: payload.kind,
            model: payload.model,
            status: 'queued',
            error: null,
            canResume: false,
            createdAt: new Date().toISOString(),
            items: [1, 2].map((index) => ({
              id: randomUUID(),
              index: index - 1,
              status: 'queued',
              providerTaskId: null,
              attemptCount: 0,
              nextRunAt: new Date().toISOString(),
              error: null,
              canResume: false,
              asset: makeAsset(index),
            })),
          };
          // Simulate a lost submission response: GET recovery must find the original task.
          await route.abort('connectionreset');
          return;
        }
        taskReads++;
        json = task ? [task] : [];
      } else if (pathname.endsWith('/resume')) {
        resumes++;
        task.status = 'generating';
        task.canResume = false;
        task.error = null;
        task.items.forEach((item) => {
          item.status = 'generating';
          item.canResume = false;
        });
        json = task;
      }
      await route.fulfill({ json });
    });
    const base = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
    const url = `${base}/canvas/${canvasId}`;
    await page.goto(url);
    await expect.poll(() => taskReads).toBe(1);
    await page.waitForTimeout(3500);
    if (taskReads !== 1) throw new Error('Empty canvas polls generation tasks');
    const textNode = () => page.locator('.react-flow__node[data-id="text"]');
    await textNode().click();
    const submit = page.getByRole('button', { name: '生成脚本', exact: true });
    await expect(submit).toBeEnabled();
    await submit.dblclick({ force: true });
    await expect.poll(() => posts).toBe(1);
    await expect(submit).toBeDisabled();
    if (
      payload.count !== 2 ||
      payload.nodeId !== 'text' ||
      payload.canvasId !== canvasId ||
      payload.userPrompt !== '写一段测试文案' ||
      !payload.prompt.includes('引用文本内容') ||
      payload.references[0].content !== '引用文本内容'
    )
      throw new Error('Request lost batch/node/reference snapshot');

    // Load an old graph with no task metadata: the database task must restore the lock.
    graph = structuredClone(originalGraph);
    await page.reload();
    await textNode().click();
    await expect(submit).toBeDisabled();
    await expect(textNode().getByText('生成中', { exact: true })).toBeVisible();
    await expect(page.getByText('排队中', { exact: false })).toHaveCount(0);
    if (posts !== 1) throw new Error('Reload resubmitted generation');

    task.status = 'unknown';
    task.error = '暂时无法查询生成结果，请稍后继续查询原任务';
    task.canResume = true;
    task.items.forEach((item) => {
      item.status = 'unknown';
      item.providerTaskId = 'provider-id';
      item.canResume = true;
    });
    await expect(page.getByRole('button', { name: '继续查询', exact: true })).toBeVisible();
    await expect(submit).toBeDisabled();
    await page.getByRole('button', { name: '继续查询', exact: true }).click();
    await expect.poll(() => resumes).toBe(1);
    if (posts !== 1) throw new Error('Resume called submission instead of original-task lookup');

    task.status = 'completed';
    task.canResume = false;
    task.error = null;
    task.items.forEach((item, index) => {
      item.status = 'completed';
      item.canResume = false;
      item.asset.status = 'ready';
      item.asset.content = `生成结果${index + 1}`;
    });
    await expect(textNode().getByText('生成结果1', { exact: true })).toBeVisible();
    await expect(submit).toBeEnabled();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await expect(page.getByText('生成结果2', { exact: true })).toBeVisible();
    await expect.poll(() => graph.nodes.length).toBe(3);
    await page.reload();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await textNode().click();
    await expect(submit).toBeEnabled();
    if (posts !== 1 || errors.length) throw new Error(errors.join('\n') || 'Duplicate submission');
    const completedReads = taskReads;
    await page.waitForTimeout(6500);
    if (taskReads !== completedReads)
      throw new Error('Completed batch still polls generation tasks');
    await submit.click();
    await expect.poll(() => posts).toBe(2);
    await expect(submit).toBeDisabled();
    const restartedReads = taskReads;
    await expect.poll(() => taskReads).toBeGreaterThan(restartedReads);
    console.log(
      'PASS: no idle polling, double click submits once, lost response recovers, reload restores lock, resume queries original task, batch completion stops polling and a new submission restarts it',
    );
    await page.close();

    // Both fresh failures and regeneration over existing content must stay inside the node.
    for (const kind of ['text', 'image', 'video']) {
      const feedbackPage = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
      feedbackPage.setDefaultTimeout(12000);
      feedbackPage.on('pageerror', (error) => errors.push(error.message));
      const busy = '模型繁忙，请更换模型或稍后再试';
      const id = randomUUID();
      const currentTask = {
        id: randomUUID(),
        requestId: randomUUID(),
        nodeId: 'subject',
        kind,
        model: 'test-model',
        status: 'queued',
        error: busy,
        canResume: false,
        createdAt: new Date().toISOString(),
        items: [
          {
            id: randomUUID(),
            index: 0,
            status: 'queued',
            providerTaskId: null,
            attemptCount: 1,
            nextRunAt: new Date().toISOString(),
            error: busy,
            canResume: false,
            asset: { ...makeAsset(1), kind },
          },
        ],
      };
      const fixture = {
        id,
        name: '失败提示验证',
        graph: {
          version: 1,
          nodes: [
            {
              id: 'subject',
              position: { x: 200, y: 100 },
              data: {
                kind,
                title: '目标节点',
                content: '保留已有内容',
                prompt: '测试提示词',
                ...(kind === 'image'
                  ? {
                      url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
                    }
                  : {}),
              },
            },
          ],
          edges: [],
          viewport: { x: 10, y: 10, zoom: 0.7 },
        },
      };
      let reads = 0;
      await feedbackPage.route('**/api/**', async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        let json = [];
        if (pathname === '/api/auth/me') json = { id: 'user', name: '测试用户' };
        else if (pathname === `/api/canvases/${id}`) json = fixture;
        else if (pathname === '/api/generation-tasks') {
          reads++;
          json = [currentTask];
        }
        await route.fulfill({ json });
      });
      await feedbackPage.goto(`${base}/canvas/${id}`);
      const node = feedbackPage.locator('.react-flow__node[data-id="subject"]');
      await node.click();
      const form = feedbackPage.locator('.react-flow__node-toolbar form');
      await expect(node.getByText('生成中', { exact: true })).toBeVisible();
      await node.click();
      await expect(form).toBeVisible();
      await expect(feedbackPage.getByText('排队中', { exact: false })).toHaveCount(0);
      await expect(feedbackPage.getByText(busy, { exact: true })).toHaveCount(0);
      await expect(form.getByRole('alert')).toHaveCount(0);
      for (const state of ['submitting', 'generating', 'saving']) {
        currentTask.status = state;
        currentTask.items[0].status = state;
        const previous = reads;
        await expect.poll(() => reads).toBeGreaterThan(previous);
        await expect(node.getByText('生成中', { exact: true })).toBeVisible();
        await expect(form.getByText(busy, { exact: true })).toHaveCount(0);
      }
      currentTask.status = 'failed';
      currentTask.items[0].status = 'failed';
      currentTask.items[0].asset.status = 'failed';
      await expect(node.getByRole('alert')).toHaveText(busy);
      const errorPresentation = await node
        .locator('[data-generation-error]')
        .evaluate((element) => ({
          background: getComputedStyle(element).backgroundColor,
          align: getComputedStyle(element).textAlign,
        }));
      if (
        errorPresentation.background !== 'rgba(0, 0, 0, 0)' ||
        errorPresentation.align !== 'center'
      )
        throw new Error(`${kind}: error is not centered on a transparent background`);
      if (kind === 'video') {
        const iconBox = await node.locator('[data-node-placeholder-icon]').boundingBox();
        const errorBox = await node.getByRole('alert').boundingBox();
        if (errorBox.y < iconBox.y + iconBox.height)
          throw new Error('Video error is not below its icon');
      }
      const toast = feedbackPage.locator('[data-toast-type="error"]').filter({ hasText: busy });
      await expect(toast).toBeVisible();
      const toastBox = await toast.boundingBox();
      if (toastBox.y < 15 || toastBox.y > 40 || Math.abs(toastBox.x + toastBox.width / 2 - 800) > 2)
        throw new Error('Generation failure toast is not top centered');
      await node.click();
      await expect(form.getByText(busy, { exact: true })).toHaveCount(0);
      await expect(node.getByText('生成中', { exact: true })).toHaveCount(0);
      await expect(form.locator('button[type="submit"]')).toBeEnabled();
      await expect(toast).toHaveCount(0, { timeout: 5000 });
      const finishedReads = reads;
      await feedbackPage.waitForTimeout(6500);
      if (reads !== finishedReads)
        throw new Error(`${kind}: failed task keeps polling generation-tasks`);
      await expect(toast).toHaveCount(0);
      await expect(node.getByRole('alert')).toHaveText(busy);
      // Old graph errors and terminal API records must both be silent on a new visit.
      Object.assign(fixture.graph.nodes[0].data, {
        status: kind === 'text' ? 'generating' : 'failed',
        error: busy,
        generationTaskId: currentTask.id,
        generationStatus: kind === 'text' ? 'queued' : 'failed',
        generationAppliedTaskId: kind === 'text' ? undefined : currentTask.id,
        generationMessage: busy,
        generationFailureVisible: true,
      });
      const readsBeforeReload = reads;
      await feedbackPage.reload();
      await expect.poll(() => reads).toBeGreaterThan(readsBeforeReload);
      await expect(node).toBeVisible();
      await expect(node.getByRole('alert')).toHaveCount(0);
      await expect(toast).toHaveCount(0);
      await node.click();
      await expect(form.locator('button[type="submit"]')).toBeEnabled();
      if (kind === 'video') {
        // A running task restored on entry may still report a new failure during this visit.
        currentTask.status = 'generating';
        currentTask.items[0].status = 'generating';
        currentTask.error = null;
        await feedbackPage.reload();
        await expect(node.getByText('生成中', { exact: true })).toBeVisible();
        currentTask.status = 'failed';
        currentTask.items[0].status = 'failed';
        currentTask.error = busy;
        await expect(node.getByRole('alert')).toHaveText(busy);
        await expect(toast).toBeVisible();
        await feedbackPage.getByRole('button', { name: '返回工作空间', exact: true }).click();
        await expect(toast).toHaveCount(0, { timeout: 1000 });
        const readsBeforeReturn = reads;
        await feedbackPage.goBack();
        await expect.poll(() => reads).toBeGreaterThan(readsBeforeReturn);
        await expect(node).toBeVisible();
        await expect(node.getByRole('alert')).toHaveCount(0);
        await expect(toast).toHaveCount(0);
      }
      await feedbackPage.close();
      console.log(
        `PASS: ${kind} shows only generating, hides retry errors, displays a centered background-free failure once, and stops terminal-task polling`,
      );
    }
    if (errors.length) throw new Error(errors.join('\n'));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
