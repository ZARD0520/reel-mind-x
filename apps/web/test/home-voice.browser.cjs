const { chromium, expect } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__micCalls = 0;
      window.__trackStops = 0;
      window.__micMode = 'ok';
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
        window.__micCalls++;
        if (window.__micMode === 'denied') throw new DOMException('Denied', 'NotAllowedError');
        if (window.__micMode === 'pending') await new Promise(resolve => { window.__resolveMic = resolve; });
        return { getTracks: () => [{ stop: () => { window.__trackStops++; } }] };
      } });
      window.MediaRecorder = class {
        static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
        constructor(_stream, options) { this.mimeType = options.mimeType; this.state = 'inactive'; }
        start() { this.state = 'recording'; }
        stop() {
          if (this.state !== 'recording') throw new Error('Stopped twice');
          this.state = 'inactive';
          setTimeout(() => {
            this.ondataavailable?.({ data: new Blob(['recorded voice'], { type: this.mimeType }) });
            this.onstop?.();
          }, 0);
        }
      };
    });
    let authenticated = false, requests = 0, creates = 0, reply = '小狗在海边散步', failure = false;
    let respond, receivedBody;
    await page.route('**/api/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      if (pathname === '/api/auth/me') return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { id: 'user', name: 'Test' } : {} });
      if (pathname === '/api/audio/transcriptions') {
        requests++;
        receivedBody = request.postDataBuffer().toString();
        await new Promise(resolve => { respond = resolve; });
        return route.fulfill({ status: failure ? 503 : 201, json: failure ? { message: 'busy' } : { text: reply } }).catch(() => {});
      }
      if (pathname === '/api/canvases' && request.method() === 'POST') creates++;
      return route.fulfill({ json: pathname === '/api/credits/balance' ? { available: 100, frozen: 0 } : [] });
    });
    const base = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8899';
    await page.goto(base);
    const mic = () => page.getByRole('button', { name: '语音输入', exact: true });
    await mic().click();
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
    expect(await page.evaluate(() => window.__micCalls)).toBe(0);
    authenticated = true;
    await page.reload();
    const input = page.getByRole('textbox', { name: '描述你的创作目标' });
    await input.fill('已有创意');
    await mic().click();
    await expect(page.getByRole('status')).toContainText('录音中');
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '结束录音并转文字' }).click();
    await expect.poll(() => requests).toBe(1);
    expect(receivedBody).toContain('name="file"');
    expect(receivedBody).toContain('recording.webm');
    expect(receivedBody).toContain('recorded voice');
    expect(receivedBody).not.toContain('sk-');
    await input.fill('识别时继续编辑');
    respond();
    await expect(input).toHaveText('识别时继续编辑 小狗在海边散步');
    expect(creates).toBe(0);
    expect(await page.evaluate(() => window.__trackStops)).toBe(1);
    // Cancelled recordings are discarded and release the microphone.
    await mic().click();
    await page.getByRole('button', { name: '取消语音输入' }).click();
    await expect(mic()).toBeEnabled();
    expect(requests).toBe(1);
    // Permission denial leaves the existing draft intact.
    await page.evaluate(() => { window.__micMode = 'denied'; });
    await mic().click();
    await expect(page.getByText('麦克风权限被拒绝，请在浏览器中允许访问麦克风', { exact: true })).toBeVisible();
    await expect(input).toHaveText('识别时继续编辑 小狗在海边散步');
    await page.evaluate(() => { window.__micMode = 'ok'; });
    // Failed requests recover to an enabled microphone without changing the draft.
    failure = true;
    await mic().click();
    await page.getByRole('button', { name: '结束录音并转文字' }).click();
    await expect.poll(() => requests).toBe(2);
    respond();
    await expect(mic()).toBeEnabled();
    await expect(page.getByText('语音识别失败，请稍后重新录音', { exact: true })).toBeVisible();
    // Cancelled permission requests must release a stream that arrives later.
    await page.evaluate(() => { window.__micMode = 'pending'; });
    await mic().click();
    await expect(page.getByRole('button', { name: '正在请求麦克风' })).toBeDisabled();
    await page.getByRole('button', { name: '取消语音输入' }).click();
    const before = await page.evaluate(() => window.__trackStops);
    await page.evaluate(() => window.__resolveMic());
    await expect.poll(() => page.evaluate(() => window.__trackStops)).toBe(before + 1);
    await expect(mic()).toBeEnabled();
    // Leaving home stops an active recorder without sending the recording.
    await page.evaluate(() => { window.__micMode = 'ok'; });
    await mic().click();
    await expect(page.getByRole('button', { name: '结束录音并转文字' })).toBeVisible();
    await page.getByRole('button', { name: '工作空间', exact: true }).click();
    expect(requests).toBe(2);
    expect(errors).toEqual([]);
    console.log('Home voice login, recording, multipart upload, draft append, cancellation, permissions, failure and cleanup passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
