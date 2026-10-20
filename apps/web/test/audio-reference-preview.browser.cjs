const { chromium, expect } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => console.error(error.message));
    await page.addInitScript(() => {
      window.previewPlays = 0;
      window.previewPauses = 0;
      HTMLMediaElement.prototype.play = function () { window.previewPlays++; return Promise.resolve(); };
      HTMLMediaElement.prototype.pause = function () { window.previewPauses++; };
    });
    await page.route('**/preview.wav', route => route.fulfill({ status: 204 }));
    await page.route('**/audio-preview-test', route => route.fulfill({
      contentType: 'text/html',
      body: `<html><body><div id="root"></div><script type="module">
        import React from '/node_modules/.vite/deps/react.js';
        import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
        import RefreshRuntime from '/@react-refresh';
        import '/src/index.css';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => type => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        const source = await (await fetch('/src/features/canvas/components/ReferenceHoverPreview.tsx')).text();
        const queryModule = source.match(/from "([^"]*@tanstack_react-query[^\"]*)"/)[1];
        const { QueryClient, QueryClientProvider } = await import(queryModule);
        const { useReferenceHoverPreview } = await import('/src/features/canvas/components/ReferenceHoverPreview.tsx');
        const { ReferencePreview } = await import('/src/components/ui/ReferencePreview.tsx');
        function Harness() {
          const hover = useReferenceHoverPreview();
          return React.createElement(React.Fragment, null,
            React.createElement('button', {
              style: { margin: '200px' },
              onMouseEnter: event => hover.show({ id: 'audio', kind: 'audio', title: 'Audio', url: '/preview.wav' }, event.currentTarget),
              onMouseLeave: hover.hide,
            }, 'Audio reference'), hover.preview,
            React.createElement(ReferencePreview, { reference: { kind: 'audio', name: 'Dependency audio', url: '/preview.wav' } },
              React.createElement('button', null, 'Dependency audio')));
        }
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(Harness)));
      </script></body></html>`,
    }));
    await page.goto(`${process.env.E2E_BASE_URL ?? 'http://localhost:5173'}/audio-preview-test`);
    const seekPreview = async () => {
      const tooltip = page.getByRole('tooltip');
      await tooltip.locator('audio').evaluate(audio => {
        Object.defineProperty(audio, 'duration', { configurable: true, value: 10 });
        audio.dispatchEvent(new Event('loadedmetadata'));
      });
      const progress = tooltip.getByRole('slider', { name: '音频播放进度' });
      await expect(progress).toBeEnabled();
      const bounds = await progress.boundingBox();
      await progress.click({ position: { x: bounds.width * 0.7, y: bounds.height / 2 } });
      await expect.poll(() => tooltip.locator('audio').evaluate(audio => audio.currentTime)).toBeGreaterThan(5);
    };
    await page.getByRole('button', { name: 'Audio reference' }).hover();
    await expect(page.getByRole('tooltip').getByRole('group', { name: '音频波形' })).toBeVisible();
    await expect(page.getByRole('tooltip').getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('tooltip').locator('[data-audio-time]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.previewPlays)).toBe(1);
    await seekPreview();
    await page.mouse.move(10, 10);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.previewPauses)).toBe(1);
    await page.getByRole('button', { name: 'Dependency audio', exact: true }).hover();
    await expect(page.getByRole('tooltip').getByRole('group', { name: '音频波形' })).toBeVisible();
    await expect(page.getByRole('tooltip').getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('tooltip').locator('[data-audio-time]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.previewPlays)).toBe(2);
    await seekPreview();
    await page.mouse.move(10, 10);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.previewPauses)).toBe(2);
    console.log('PASS: audio reference hover shows waveform, starts playback and pauses on dismissal');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
