import { chromium } from '@playwright/test';
const log = [];
const L = (m) => { log.push(m); console.log(m); };
try {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  L('nav home');
  await page.goto('http://localhost:5173/', { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  L('title: ' + await page.title());
  const btn = page.locator('button:has-text("新建项目")');
  L('create btn count: ' + await btn.count());
  if (await btn.count()) { await btn.first().click(); await page.waitForURL('**/editor/**',{timeout:10000}); }
  L('url: ' + page.url());
  await page.waitForSelector('[data-track-id], text=从左侧', { timeout: 10000 }).catch(()=>L('no track/empty marker'));
  L('tracks: ' + await page.locator('[data-track-id]').count());
  L('assets in library: ' + await page.locator('[draggable=true]').count());
  await browser.close();
  L('DONE');
} catch (e) { L('ERROR: ' + e.message); }
import { writeFileSync } from 'fs';
writeFileSync('/tmp/dragtest.log', log.join('\n'));
