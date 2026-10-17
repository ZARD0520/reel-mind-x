const { chromium, expect } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    const base = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
    await page.route('**/toast-test', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `
      <html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
        import React from '/node_modules/.vite/deps/react.js';
        import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
        import RefreshRuntime from '/@react-refresh';
        import '/src/index.css';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => type => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        const { ToastProvider, useToast } = await import('/src/components/ui/Toast.tsx');
        function Harness() {
          const toast = useToast();
          return React.createElement('main', null,
            ...['info', 'success', 'error', 'warning'].map(type => React.createElement('button', { key: type, onClick: () => toast[type](type + '测试') }, type)),
            React.createElement('button', { onClick: () => toast.info('很长的提示内容'.repeat(80)) }, 'long'),
            React.createElement('button', { onClick: () => document.querySelector('dialog').showModal() }, 'open modal'),
            React.createElement('dialog', { style: { margin: 'auto', padding: '80px', background: '#333' } },
              React.createElement('button', { onClick: () => toast.error('弹窗失败提示') }, 'modal error'),
              React.createElement('button', { onClick: () => document.querySelector('dialog').close() }, 'close modal')));
        }
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, null, React.createElement(ToastProvider, null, React.createElement(Harness))));
      </script></body></html>`,
      }),
    );
    await page.goto(`${base}/toast-test`);
    for (const type of ['info', 'success', 'error', 'warning']) {
      await page.getByRole('button', { name: type, exact: true }).click();
      const toast = page.locator(`[data-toast-type="${type}"]`);
      await expect(toast).toBeVisible();
      await expect(toast).toHaveAttribute(
        'role',
        type === 'error' || type === 'warning' ? 'alert' : 'status',
      );
      const box = await toast.boundingBox();
      if (Math.abs(box.x + box.width / 2 - 720) > 2 || box.y < 15 || box.y > 40)
        throw new Error(`${type} toast is not top centered: ${JSON.stringify(box)}`);
      await toast.getByRole('button', { name: '关闭提示' }).click();
      await expect(toast).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'info', exact: true }).click();
    await page.getByRole('button', { name: 'open modal', exact: true }).click();
    await page.getByRole('button', { name: 'modal error', exact: true }).click();
    const modalToast = page.locator('[data-toast-type="error"]');
    await expect(modalToast).toBeVisible();
    const covered = await modalToast.evaluate((element) => {
      const r = element.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !element.contains(top);
    });
    if (covered) throw new Error('Modal obscures toast');
    await modalToast.getByRole('button', { name: '关闭提示' }).click();
    await page.getByRole('button', { name: 'modal error', exact: true }).click();
    await page.getByRole('button', { name: 'close modal', exact: true }).click();
    await expect(modalToast).toBeVisible();
    await modalToast.getByRole('button', { name: '关闭提示' }).click();
    await expect(page.locator('[data-toaster]')).toHaveCount(0, { timeout: 5000 });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole('button', { name: 'long', exact: true }).click();
    const long = page.locator('[data-toast-type="info"]').filter({ hasText: '很长' });
    await expect(long).toBeVisible();
    const longBox = await long.boundingBox();
    if (longBox.x < 0 || longBox.x + longBox.width > 375 || longBox.height < 60)
      throw new Error('Long mobile toast overflows or fails to wrap');
    await long.getByRole('button', { name: '关闭提示' }).click();
    await page.getByRole('button', { name: 'success', exact: true }).click();
    await expect(page.locator('[data-toast-type="success"]')).toHaveCount(0, { timeout: 5000 });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(
      'PASS: four toast variants, top-centered positioning, manual/automatic dismissal, native modal stacking and mobile long text',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
