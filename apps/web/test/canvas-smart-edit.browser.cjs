const { chromium, expect } = require('@playwright/test');
const { randomUUID: uuid } = require('node:crypto');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    const canvasId = uuid(), projectId = uuid(), standaloneId = uuid();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let graph = { version: 1, viewport: { x: 120, y: 150, zoom: 0.8 }, nodes: [
      { id: 'video', type: 'workflow', position: { x: 0, y: 0 }, data: { kind: 'video', title: '视频素材', assetId: uuid(), status: 'ready' } },
      { id: 'image', type: 'workflow', position: { x: 700, y: 0 }, data: { kind: 'image', title: '图片素材', assetId: uuid(), status: 'ready' } },
    ], edges: [] };
    const assets = graph.nodes.map(node => ({ id: uuid(), projectId, kind: node.data.kind, name: node.data.title, status: 'ready', source: 'upload', url: null, durationInFrames: 150, width: 1920, height: 1080, createdAt: new Date().toISOString() }));
    let project;
    let opens = 0;
    const baseTimeline = { settings: { width: 1920, height: 1080, fps: 30 }, tracks: [] };
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const method = route.request().method();
      let json = [];
      if (path === '/api/auth/me') json = { id: uuid(), name: 'Test' };
      else if (path === `/api/canvases/${canvasId}`) {
        if (method === 'PATCH') graph = route.request().postDataJSON().graph ?? graph;
        json = { id: canvasId, name: '智能剪辑测试', graph };
      } else if (path.startsWith('/api/assets/') && !path.endsWith('/assets')) {
        const source = graph.nodes.find(node => node.data.assetId === path.split('/').at(-1));
        json = source ? { id: source.data.assetId, kind: source.data.kind, status: 'ready', url: null } : {};
      } else if (path === '/api/projects/from-canvas-edit') {
        const body = route.request().postDataJSON();
        expect(body.canvasId).toBe(canvasId);
        expect(graph.edges.filter(edge => edge.target === body.nodeId)).toHaveLength(2);
        opens++;
        graph.nodes.find(node => node.id === body.nodeId).data.editorProjectId = projectId;
        project = { id: projectId, name: '智能剪辑', timeline: { ...baseTimeline, canvasSource: { canvasId, nodeId: body.nodeId, assets: assets.map((asset, i) => ({ assetId: asset.id, sourceAssetId: graph.nodes[i].data.assetId })) } } };
        json = project;
      } else if (path === `/api/projects/${projectId}`) {
        if (method === 'PATCH') project = { ...project, ...route.request().postDataJSON() };
        json = project;
      } else if (path === '/api/assets' && new URL(route.request().url()).searchParams.get('projectId') === projectId) json = assets;
      else if (path === `/api/projects/${standaloneId}`) json = { id: standaloneId, name: '独立剪辑', timeline: baseTimeline };
      await route.fulfill({ json });
    });
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173'}/canvas/${canvasId}`);
    const video = page.locator('.react-flow__node[data-id="video"]');
    await video.click({ button: 'right' });
    await expect(page.locator('[data-node-action-menu]')).toBeVisible();
    await expect(page.locator('[data-node-action-menu]').getByRole('button', { name: '编辑', exact: true })).toHaveCount(0);
    await page.mouse.dblclick(1200, 720);
    const menu = page.locator('[data-add-node-menu]');
    const labels = await menu.getByRole('button').allTextContents();
    expect(labels.findIndex(label => label.includes('智能剪辑'))).toBe(labels.findIndex(label => label.includes('视频节点')) + 1);
    await menu.getByRole('button', { name: /智能剪辑/ }).click();
    const editNode = page.locator('.react-flow__node').filter({ has: page.getByLabel('智能剪辑名称') });
    await expect(editNode).toBeVisible();
    await expect(editNode.getByRole('button', { name: '打开剪辑' })).toBeDisabled();
    await editNode.getByRole('button', { name: '添加剪辑素材' }).click();
    await video.click();
    await editNode.getByRole('button', { name: '添加剪辑素材' }).click();
    await page.locator('.react-flow__node[data-id="image"]').click();
    await expect(editNode.getByRole('button', { name: '打开剪辑' })).toBeEnabled();
    await editNode.getByRole('button', { name: '打开剪辑' }).click();
    await expect(page).toHaveURL(new RegExp(`/editor/${projectId}`));
    await expect(page.getByText('引用素材', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '导入素材', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '生成图片', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '生成视频', exact: true })).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /AI 混编/ })).toHaveCount(0);
    await expect(page.getByTitle('删除素材')).toHaveCount(0);
    await expect(page.getByText('图片素材', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '文本', exact: true }).click();
    await expect(page.getByRole('button', { name: 'AI 生成文案' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '添加文本', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/canvas/${canvasId}`));
    await expect(page.getByLabel('智能剪辑名称')).toBeVisible();
    await page.getByRole('button', { name: '打开剪辑' }).click();
    await expect(page).toHaveURL(new RegExp(`/editor/${projectId}`));
    expect(opens).toBe(2);
    // A directly opened ordinary editor retains upload and generation features.
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173'}/editor/${standaloneId}`);
    await expect(page.getByRole('button', { name: '导入素材', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '生成图片', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '生成视频', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
    console.log('PASS: smart edit node placement, dependencies, navigation, restricted editor, reopen, and standalone capabilities');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
