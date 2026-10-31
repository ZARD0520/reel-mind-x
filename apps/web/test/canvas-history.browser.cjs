const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const id = randomUUID();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let graph = { version: 1, viewport: { x: 200, y: 200, zoom: 1 }, edges: [{ id: 'ab', source: 'a', target: 'b' }], nodes: [
      { id: 'a', position: { x: 0, y: 0 }, data: { kind: 'text', title: 'First', content: 'first text', status: 'ready' } },
      { id: 'b', position: { x: 450, y: 0 }, data: { kind: 'text', title: 'Second', content: 'second text', status: 'ready' } },
    ] };
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      let json = [];
      if (path === '/api/auth/me') json = { id: 'user', name: 'Test' };
      else if (path === `/api/canvases/${id}`) {
        if (route.request().method() === 'PATCH') graph = route.request().postDataJSON().graph ?? graph;
        json = { id, name: 'History', graph };
      }
      await route.fulfill({ json });
    });
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173'}/canvas/${id}`);
    const first = page.locator('.react-flow__node[data-id="a"]');
    const shortcut = async key => {
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press(key);
    };
    await expect(first).toBeVisible();
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toHaveCount(0);
    await shortcut('Control+Shift+z');
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    // A drag is one edit, even though React Flow emits many position changes.
    const start = await first.boundingBox();
    await page.mouse.move(start.x + 20, start.y + 15);
    await page.mouse.down();
    await page.mouse.move(start.x + 140, start.y + 63, { steps: 12 });
    await page.mouse.up();
    await shortcut('Control+z');
    await expect.poll(async () => Math.round((await first.boundingBox()).x)).toBe(Math.round(start.x));
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toHaveCount(0);
    await shortcut('Control+Shift+z');
    await expect.poll(async () => Math.round((await first.boundingBox()).x)).toBe(Math.round(start.x + 120));
    // Delete restores both the node and its reference edge.
    await first.locator('.workflow-node-title').click({ position: { x: 20, y: 10 } });
    await page.keyboard.press('Delete');
    await expect(first).toHaveCount(0);
    await expect(page.locator('.react-flow__edge')).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(first).toBeVisible();
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await page.keyboard.press('Control+Shift+z');
    await expect(first).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(first).toBeVisible();
    // Rename and restore without hijacking native input undo.
    await first.locator('.workflow-node-title button').dblclick();
    const title = page.getByRole('textbox', { name: '修改节点名称' });
    await title.fill('Renamed');
    await page.keyboard.press('Control+z');
    await expect(first).toBeVisible();
    await title.fill('Renamed');
    await title.press('Enter');
    await expect(first.locator('.workflow-node-title')).toContainText('Renamed');
    await page.mouse.click(1250, 700);
    await page.keyboard.press('Control+z');
    await expect(first.locator('.workflow-node-title')).toContainText('First');
    await page.keyboard.press('Control+y');
    await expect(first.locator('.workflow-node-title')).toContainText('Renamed');
    // New structure clears the redo branch; restored graph is autosaved.
    await shortcut('Control+z');
    await page.mouse.dblclick(1250, 700);
    await page.getByRole('button', { name: /音频节点 添加音频素材/ }).click();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await shortcut('Control+Shift+z');
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await shortcut('Control+z');
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    await expect.poll(() => graph.nodes.length).toBe(2);
    await expect.poll(() => graph.nodes.find(node => node.id === 'a').data.title).toBe('First');
    await page.reload();
    await expect(first).toBeVisible();
    await expect(page.getByRole('button', { name: '撤销', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
    console.log('PASS: canvas keyboard undo/redo, drag, delete/edges, shortcuts, rename, input isolation, branch, autosave and reload');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
