const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');

function audioFixture() {
  const sampleRate = 8000;
  const samples = sampleRate * 8;
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const envelope = 0.2 + 0.8 * Math.abs(Math.sin(i / sampleRate));
    bytes.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 220 / sampleRate) * envelope * 12000), 44 + i * 2);
  }
  return bytes;
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const canvasId = randomUUID();
    let graph = { version: 1, nodes: [{ id: 'audio', position: { x: 100, y: 100 }, data: {
      kind: 'audio', uploaded: true, title: 'Audio fixture', url: '/test-audio.wav', content: '', status: 'ready',
    } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    await page.route('**/test-audio.wav', (route) => {
      const bytes = audioFixture();
      const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
      const start = range ? Number(range[1]) : 0;
      const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
      return route.fulfill({
        status: range ? 206 : 200,
        contentType: 'audio/wav',
        headers: { 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${end}/${bytes.length}` } : {}) },
        body: bytes.subarray(start, end + 1),
      });
    });
    await page.route('**/api/**', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      let json = [];
      if (pathname === '/api/auth/me') json = { id: 'user', name: 'Test' };
      if (pathname === `/api/canvases/${canvasId}`) {
        if (route.request().method() === 'PATCH') graph = route.request().postDataJSON().graph ?? graph;
        json = { id: canvasId, name: 'Audio player', graph };
      }
      await route.fulfill({ json });
    });
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8899'}/canvas/${canvasId}`);
    const node = page.locator('.react-flow__node[data-id="audio"]');
    const player = node.locator('[data-audio-player]');
    const audio = player.locator('audio');
    await expect(player).toBeVisible();
    expect(await audio.evaluate((element) => element.controls)).toBe(false);
    await expect(player.locator('[data-audio-time]')).toHaveText('0:00 / 0:08');
    await expect.poll(() => player.locator('svg rect').evaluateAll((bars) => new Set(bars.map((bar) => bar.getAttribute('height'))).size)).toBeGreaterThan(5);
    const waveform = player.locator('[data-audio-waveform]');
    const playhead = player.locator('[data-audio-playhead]');
    await expect(waveform).toHaveCSS('background-color', 'rgb(24, 24, 27)');
    await expect(playhead).toHaveCSS('background-color', 'rgb(239, 68, 68)');
    // Blank space inside the player must remain a node drag surface.
    const playerBounds = await player.boundingBox();
    // Audio cards use a compact height, with only a small margin around the waveform.
    const playerHeight = await player.evaluate((element) => element.clientHeight);
    expect(playerHeight).toBe(214);
    const scale = playerBounds.height / playerHeight;
    const waveformArea = await waveform.boundingBox();
    const playbackButton = await player.getByRole('button').boundingBox();
    expect((waveformArea.y - playerBounds.y) / scale).toBeLessThan(15);
    expect((waveformArea.x - playerBounds.x) / scale).toBeLessThan(15);
    expect((playbackButton.y - (waveformArea.y + waveformArea.height)) / scale).toBeLessThan(15);
    const originalBounds = await node.boundingBox();
    await page.mouse.move(playerBounds.x + 8, playerBounds.y + 20);
    await page.mouse.down();
    await page.mouse.move(playerBounds.x + 108, playerBounds.y + 70, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await node.boundingBox()).x - originalBounds.x).toBeGreaterThan(50);
    await expect.poll(() => graph.nodes[0].position.x).toBeGreaterThan(130);
    const initialPosition = await node.getAttribute('style');
    await player.getByRole('button').hover();
    await expect(player.getByRole('button')).toHaveCSS('cursor', 'pointer');
    await player.getByRole('button').click();
    await expect(player.getByRole('button', { name: '\u6682\u505c\u97f3\u9891' })).toBeVisible();
    await expect.poll(() => audio.evaluate((element) => element.currentTime)).toBeGreaterThan(0.1);
    await player.getByRole('button').click();
    expect(await audio.evaluate((element) => element.paused)).toBe(true);
    const slider = player.getByRole('slider');
    const waveformBounds = await slider.boundingBox();
    await slider.click({ position: { x: waveformBounds.width / 2, y: waveformBounds.height / 2 } });
    await expect.poll(() => audio.evaluate((element) => element.currentTime)).toBeGreaterThan(3.5);
    await slider.fill('4');
    await expect(player.locator('[data-audio-time]')).toHaveText('0:04 / 0:08');
    expect(await audio.evaluate((element) => element.currentTime)).toBe(4);
    const region = await waveform.boundingBox();
    const line = await playhead.boundingBox();
    expect(Math.abs(line.x + line.width / 2 - (region.x + region.width / 2))).toBeLessThan(2);
    await slider.focus();
    await slider.press('ArrowRight');
    expect(await audio.evaluate((element) => element.currentTime)).toBeGreaterThan(4);
    expect(await node.getAttribute('style')).toBe(initialPosition);
    await slider.fill('7.9');
    await player.getByRole('button').click();
    await expect.poll(() => audio.evaluate((element) => element.ended)).toBe(true);
    await expect(player.getByRole('button', { name: '\u64ad\u653e\u97f3\u9891' })).toBeVisible();
    await player.getByRole('button').click();
    await expect.poll(() => audio.evaluate((element) => element.currentTime)).toBeLessThan(2);
    expect(errors).toEqual([]);
    console.log('PASS: audio node dragging, waveform background and playhead, playback, seeking, replay, and stable node position during player controls');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
