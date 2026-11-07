const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1050 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const canvasId = randomUUID();
    let graph = { version: 1, nodes: [
      { id: 'target', position: { x: 400, y: 120 }, data: { kind: 'image', title: 'Target', prompt: '', status: 'idle' } },
      { id: 'source', position: { x: 850, y: 120 }, data: { kind: 'text', title: 'Source', content: 'source content', status: 'ready' } },
      { id: 'photo', position: { x: 1800, y: 120 }, data: { kind: 'image', title: 'Photo', url: '/reference-image.svg', status: 'ready' } },
      { id: 'clip', position: { x: 2400, y: 120 }, data: { kind: 'video', title: 'Clip', url: '/reference-video.mp4', status: 'ready' } },
    ], edges: [{ id: 'source-target', source: 'source', target: 'target' }], viewport: { x: 0, y: 0, zoom: 0.7 } };
    let sent;
    const conversation = { id: randomUUID(), title: 'Test', messages: [] };
    await page.route('**/reference-image.svg', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="blue"/></svg>' }));
    await page.route('**/reference-video.mp4', (route) => route.fulfill({ status: 204 }));
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      let json = [];
      if (pathname === '/api/auth/me') json = { id: 'user', name: 'Test' };
      else if (pathname === `/api/canvases/${canvasId}`) {
        if (request.method() === 'PATCH') graph = request.postDataJSON().graph ?? graph;
        json = { id: canvasId, name: 'Inline references', graph };
      } else if (pathname.endsWith('/conversations') && request.method() === 'POST') json = conversation;
      else if (pathname.endsWith(`/conversations/${conversation.id}`)) json = conversation;
      else if (pathname.endsWith('/messages')) {
        sent = request.postDataJSON();
        conversation.messages = [{ id: 'user-message', role: 'user', content: sent.content, references: sent.references }];
        await route.fulfill({ contentType: 'text/event-stream', body: `event: delta\ndata: ${JSON.stringify({ text: 'OK' })}\n\nevent: done\ndata: ${JSON.stringify({ ...conversation, messages: [...conversation.messages, { id: 'answer', role: 'assistant', content: 'OK', references: [] }] })}\n\n` });
        return;
      }
      await route.fulfill({ json });
    });
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://localhost:5173'}/canvas/${canvasId}`);
    await page.getByRole('button', { name: '打开 Agent Chat', exact: true }).click();
    const chat = page.locator('aside [role="textbox"]');
    await chat.fill('@');
    const options = page.getByRole('option');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await chat.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(options.first()).toHaveAttribute('aria-selected', 'false');
    await chat.press('ArrowDown');
    await expect(options.nth(2)).toHaveAttribute('aria-selected', 'true');
    await chat.press('ArrowUp');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await chat.press('ArrowUp');
    await chat.press('ArrowUp');
    await expect(options.last()).toHaveAttribute('aria-selected', 'true');
    await chat.press('ArrowDown');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await expect(chat).toBeFocused();
    await chat.press('ArrowDown');
    const previousSent = sent;
    await chat.press('Enter');
    await expect(chat).toHaveText('Source ');
    expect(sent).toEqual(previousSent); // Enter selects a reference instead of submitting.
    await chat.fill('@');
    await chat.press('ArrowDown');
    await chat.pressSequentially('Ph');
    await expect(options).toHaveCount(1);
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await expect(options.first()).toContainText('Photo');
    await chat.press('Escape');
    await expect(options).toHaveCount(0);
    await expect(chat).toHaveText('@Ph');
    await chat.fill('@');
    await page.getByRole('option', { name: /Source/ }).hover();
    await expect(page.getByRole('option', { name: /Source/ })).toHaveAttribute('aria-selected', 'true');
    await expect(options.first()).toHaveAttribute('aria-selected', 'false');
    await chat.press('Enter');
    await expect(chat).toHaveText('Source ');
    // Noneditable chips must be deleted as one reference, not as label text.
    await page.mouse.move(10, 10);
    await chat.press('Backspace'); // The separator after the chip is ordinary text.
    await expect(chat.locator('[data-node-id="source"]')).toHaveCount(1);
    await chat.press('Backspace');
    await expect(chat.locator('[data-node-id]')).toHaveCount(0);
    await expect(chat).toHaveText('');
    const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
    const redo = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';
    await chat.press(undo);
    await expect(chat.locator('[data-node-id="source"]')).toHaveCount(1);
    await chat.press(redo);
    await expect(chat.locator('[data-node-id]')).toHaveCount(0);

    await chat.fill('before @Source');
    await chat.press('Enter');
    await chat.pressSequentially('after');
    await expect(chat).toHaveText('before Source after');
    await chat.evaluate(element => {
      const range = document.createRange();
      range.setStartBefore(element.querySelector('[data-node-id="source"]'));
      range.collapse(true);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    });
    await chat.press('Delete');
    await expect(chat.locator('[data-node-id]')).toHaveCount(0);
    await expect(chat).toHaveText('before  after');
    await chat.pressSequentially('X');
    await expect(chat).toHaveText('before X after');

    await chat.fill('left @Source');
    await chat.press('Enter');
    await chat.pressSequentially('@Photo');
    await chat.press('Enter');
    await chat.pressSequentially('right');
    await expect(chat.locator('[data-node-id]')).toHaveCount(2);
    await chat.evaluate(element => {
      const range = document.createRange();
      const tail = [...element.childNodes].reverse().find(node => node.nodeType === Node.TEXT_NODE && node.textContent);
      range.setStart(element.firstChild, 2);
      range.setEnd(tail, tail.textContent.length - 2);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    });
    await chat.press('Backspace');
    await expect(chat).toHaveText('leht');
    await expect(chat.locator('[data-node-id]')).toHaveCount(0);
    await chat.press(undo);
    await expect(chat.locator('[data-node-id]')).toHaveCount(2);
    await chat.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await chat.press('Backspace');
    await expect(chat).toHaveText('');
    await chat.press(undo);
    await expect(chat.locator('[data-node-id]')).toHaveCount(2);
    await chat.evaluate(element => {
      const range = document.createRange();
      range.selectNode(element.querySelector('[data-node-id="source"]'));
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    });
    await chat.press('Delete');
    await expect(chat.locator('[data-node-id="source"]')).toHaveCount(0);
    await expect(chat.locator('[data-node-id="photo"]')).toHaveCount(1);
    await expect(chat).toHaveText('left  Photo right');
    await chat.press('Enter');
    await expect.poll(() => sent?.references?.map(item => item.id)).toEqual(['photo']);
    expect(sent.content).not.toContain('node:source');
    await expect(page.locator('.react-flow__node')).toHaveCount(4);
    expect(graph.edges).toHaveLength(1);
    expect(errors).toEqual([]);
    console.log('PASS: chat mention navigation, keyboard deletion, range deletion, undo/redo and submitted reference consistency');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
