/* UI fixtures only: never mutate real accounts or call a paid model. */
const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const now = new Date().toISOString();
    const admin = {
      id: randomUUID(),
      name: '运营管理员',
      email: 'admin@example.test',
      role: 'admin',
      status: 'active',
      createdAt: now,
    };
    const user = {
      id: randomUUID(),
      name: '测试创作者',
      email: 'creator@example.test',
      role: 'user',
      status: 'active',
      createdAt: now,
      creditAccount: { available: 100, frozen: 20, spent: 30 },
    };
    let session = null;
    let entries = [];
    let audits = [];
    let signupCredits = 100;
    let capturedAdjustment;
    const prices = [
      {
        id: 'default-video',
        kind: 'video',
        model: '*',
        credits: 10,
        unit: 'second',
        enabled: true,
        version: 1,
        updatedAt: now,
      },
    ];
    const paged = (items) => ({ items, total: items.length, page: 1, pageSize: 20 });
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      let json;
      if (path === '/api/auth/me') {
        if (!session) return route.fulfill({ status: 401, json: { message: 'Login required' } });
        json = session;
      } else if (path === '/api/auth/login') {
        session = admin;
        json = { user: admin };
      } else if (path === '/api/auth/logout') {
        session = null;
        return route.fulfill({ status: 204 });
      } else if (path === '/api/admin/overview')
        json = {
          users: 42,
          tasks: 28,
          completed: 20,
          failed: 3,
          active: 5,
          available: 1000,
          frozen: 120,
          spent: 830,
          models: [
            {
              kind: 'video',
              model: 'cogvideox-flash',
              tasks: 28,
              completed: 20,
              failed: 3,
              spent: 800,
            },
          ],
        };
      else if (path === '/api/admin/users') json = paged([user]);
      else if (path.endsWith('/credits') && path.includes('/admin/users/')) {
        capturedAdjustment = request.postDataJSON();
        user.creditAccount.available += capturedAdjustment.amount;
        entries = [
          {
            id: randomUUID(),
            userId: user.id,
            type: 'adjustment',
            amount: capturedAdjustment.amount,
            availableDelta: capturedAdjustment.amount,
            frozenDelta: 0,
            availableAfter: user.creditAccount.available,
            frozenAfter: 20,
            reason: capturedAdjustment.reason,
            referenceId: null,
            actorId: admin.id,
            createdAt: now,
          },
        ];
        audits = [
          {
            id: randomUUID(),
            actorId: admin.id,
            action: 'credits.adjust',
            targetId: user.id,
            detail: capturedAdjustment,
            createdAt: now,
          },
        ];
        json = user.creditAccount;
      } else if (path === '/api/admin/ledger') json = paged(entries);
      else if (path === '/api/admin/tasks')
        json = paged([
          {
            id: randomUUID(),
            userId: user.id,
            user,
            kind: 'video',
            model: 'cogvideox-flash',
            status: 'failed',
            createdAt: now,
            creditQuote: { total: 50 },
            settlements: [{ id: 'hold', amount: 50, status: 'refunded' }],
            items: [
              {
                id: randomUUID(),
                status: 'failed',
                error: '供应商暂时不可用',
                providerTaskId: 'provider-fixture',
              },
            ],
          },
        ]);
      else if (path === '/api/admin/prices') {
        if (request.method() === 'POST')
          prices.push({ ...request.postDataJSON(), id: randomUUID(), version: 1, updatedAt: now });
        json = prices;
      } else if (path === '/api/admin/settings') {
        if (request.method() === 'PATCH') signupCredits = request.postDataJSON().signupCredits;
        json = { signupCredits };
      } else if (path === '/api/admin/audits') json = paged(audits);
      else throw new Error(`Unmocked request: ${path}`);
      await route.fulfill({ json });
    });
    const base = process.env.ADMIN_BASE_URL ?? 'http://127.0.0.1:8898';
    await page.goto(`${base}/overview`);
    await expect(page).toHaveURL(`${base}/login`);
    const loginButton = page.getByRole('button', { name: '登录管理后台' });
    await expect(loginButton).toHaveCSS('background-color', 'rgb(179, 165, 251)');
    await loginButton.hover();
    await expect(loginButton).toHaveCSS('background-color', 'rgb(198, 187, 255)');
    await page.getByLabel('管理员邮箱').fill('admin@example.test');
    await page.getByLabel('密码', { exact: true }).fill('fixture-password');
    await page.getByRole('button', { name: '登录管理后台' }).click();
    await expect(page.getByRole('heading', { name: '数据概览', exact: true })).toBeVisible();
    await expect(page).toHaveURL(`${base}/overview`);
    await expect(page.getByText('830', { exact: true })).toBeVisible();
    await expect(page.locator('aside')).toHaveCSS('position', 'fixed');
    await expect(page.locator('aside')).toHaveCSS('width', '226px');
    await expect(page.locator('main')).toHaveCSS('margin-left', '226px');
    await expect(page.locator('html')).toHaveCSS('color', 'rgb(232, 232, 237)');
    await expect(page.getByRole('columnheader').first()).toHaveCSS(
      'background-color',
      'rgb(32, 32, 39)',
    );
    await page.screenshot({ path: join(tmpdir(), 'reel-admin-overview.png'), fullPage: true });
    await page.setViewportSize({ width: 1100, height: 950 });
    await expect(page.locator('aside')).toHaveCSS('width', '200px');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('aside')).toHaveCSS('position', 'static');
    await expect(page.locator('main')).toHaveCSS('margin-left', '0px');
    const cards = page.locator('main > div > section');
    await expect(cards).toHaveCount(4);
    const boxes = await cards.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().toJSON()),
    );
    expect(boxes[0].top).toBe(boxes[1].top);
    expect(boxes[2].top).toBeGreaterThan(boxes[0].top);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: join(tmpdir(), 'reel-admin-overview-mobile.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.getByRole('link', { name: '用户管理' }).click();
    await expect(page).toHaveURL(`${base}/users`);
    await expect(page.getByRole('link', { name: '用户管理' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByText('creator@example.test')).toBeVisible();
    await page.getByRole('button', { name: '调整积分' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveCSS('background-color', 'rgb(28, 28, 36)');
    await dialog.getByLabel('调整数量').fill('50');
    await dialog.getByLabel('调整原因').fill('测试试用额度发放');
    await dialog.getByRole('button', { name: '确认调整' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('cell', { name: '150', exact: true })).toBeVisible();
    expect(capturedAdjustment.requestId).toMatch(/^[0-9a-f-]{36}$/);
    await page.getByRole('button', { name: '流水', exact: true }).click();
    await expect(page).toHaveURL(`${base}/ledger?userId=${user.id}`);
    await page.reload();
    await expect(page.getByText(`用户 ID：${user.id}`)).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(`${base}/users`);
    await page.goForward();
    await expect(page).toHaveURL(`${base}/ledger?userId=${user.id}`);
    await expect(page.getByText('测试试用额度发放')).toBeVisible();
    await page.getByRole('link', { name: '生成任务' }).click();
    await expect(page).toHaveURL(`${base}/tasks`);
    await expect(page.getByText('已退还', { exact: true })).toBeVisible();
    await page.getByText('结果 1 · 失败 · 查看原因').click();
    await expect(page.getByText('供应商暂时不可用', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: '模型定价' }).click();
    await expect(page).toHaveURL(`${base}/prices`);
    await page.getByRole('button', { name: '新增规则' }).click();
    await page.getByRole('dialog').getByLabel('模型标识').fill('test-image-model');
    await page.getByRole('dialog').getByLabel('积分', { exact: true }).fill('20');
    await page.getByRole('button', { name: '保存规则' }).click();
    await expect(page.getByText('test-image-model', { exact: true })).toBeVisible();
    await page.getByLabel('试用积分', { exact: true }).fill('200');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(() => signupCredits).toBe(200);
    await page.getByRole('link', { name: '操作审计' }).click();
    await expect(page).toHaveURL(`${base}/audits`);
    await page.getByText('查看变更').click();
    await expect(page.locator('pre')).toContainText('测试试用额度发放');
    await page.getByLabel('退出登录', { exact: true }).click();
    await expect(page.getByRole('button', { name: '登录管理后台' })).toBeVisible();
    await page.goto(`${base}/tasks`);
    await expect(page).toHaveURL(`${base}/login`);
    await page.getByLabel('管理员邮箱').fill('admin@example.test');
    await page.getByLabel('密码', { exact: true }).fill('fixture-password');
    await page.getByRole('button', { name: '登录管理后台' }).click();
    await expect(page).toHaveURL(`${base}/tasks`);
    await expect(page.getByRole('heading', { name: '生成任务', exact: true })).toBeVisible();
    session = user;
    await page.reload();
    await expect(page).toHaveURL(`${base}/login`);
    await expect(page.getByRole('alert')).toContainText('没有管理员权限');
    await expect(page.getByRole('link', { name: '用户管理' })).toHaveCount(0);

    const web = await browser.newPage({ viewport: { width: 1400, height: 950 } });
    web.on('pageerror', (error) => errors.push(error.message));
    await web.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let json = [];
      if (path === '/api/auth/me') json = user;
      else if (path === '/api/credits/balance') json = user.creditAccount;
      else if (path === '/api/credits/ledger') json = paged(entries);
      await route.fulfill({ json });
    });
    await web.goto(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8899');
    await web.getByLabel('查看积分账户').click();
    await expect(web.getByRole('dialog')).toContainText('累计消耗');
    await expect(web.getByRole('dialog')).toContainText('测试试用额度发放');
    await web.getByLabel('关闭积分账户').click();
    await expect(web.getByRole('dialog')).toHaveCount(0);
    expect(errors).toEqual([]);
    console.log(
      'PASS: independent routes, deep-link login return, refresh and history navigation, persistent user filter, all admin pages, role denial and creator wallet',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
