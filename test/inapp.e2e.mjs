// アプリ内ブラウザ（X など）で外部リンクを開いても、utawakuwaku から出ていかないことの E2E
// 実行: node test/inapp.e2e.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, getPlaywright, ROOT } from './helpers/server.mjs';
import { routeThumbs } from './helpers/fake-thumbs.mjs';

const OUT = path.join(ROOT, 'test', '.shots');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = await getPlaywright();
const srv = await startServer();
const browser = await chromium.launch();
const errors = [];
const results = [];
let failed = 0;
async function test(name, fn) {
  try { await fn(); results.push(`ok   ${name}`); }
  catch (e) { failed++; results.push(`FAIL ${name}\n     ${e.message.slice(0, 400)}`); }
}

const X_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 TwitterAndroid';

async function openApp(opts) {
  const ctx = await browser.newContext({ locale: 'ja-JP', serviceWorkers: 'block', ...opts });
  await routeThumbs(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/youtube\.com|fonts\.g|net::ERR|Failed to load resource|status of 4\d\d/.test(m.text())) errors.push(`[console] ${m.text()}`); });
  // 移動・ポップアップを記録して止める
  await page.addInitScript({ content: `
    window.__nav = [];
    window.open = (u) => { window.__nav.push(['open', String(u)]); return null; };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { window.__nav.push(['go', this.href]); };
    document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[href]'); if (a && !e.defaultPrevented) { window.__nav.push(['link', a.href]); e.preventDefault(); } });
    window.__mock = { durations: {}, defaultDuration: 600, latency: 50 };` });
  await page.addInitScript({ content: fs.readFileSync(path.join(ROOT, 'test/helpers/mock-yt.js'), 'utf8') });
  await page.goto(srv.base + '/index.html');
  await page.waitForFunction(() => window.__uta && window.__uta.engine.ready, null, { timeout: 20000 });
  await page.locator('.modal-footer .btn-primary').click().catch(() => {});
  await page.waitForTimeout(300);
  return { ctx, page };
}
const playFirst = (page) => page.evaluate(() => { const pl = window.__uta.store.currentPlaylist(); return window.__uta.actions.playPlaylist(pl.id); });

{
  const { ctx, page } = await openApp({ userAgent: X_ANDROID, viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  const sleep = (ms) => page.waitForTimeout(ms);

  await test('X のアプリ内ブラウザ: 上部に「Chromeで開く」案内（閉じるとこのセッション中は出ない）', async () => {
    const bar = page.locator('.inapp-bar');
    assert.match(await bar.innerText(), /Xのアプリ内ブラウザ[\s\S]*Chromeで開く/);
    const appTop = await page.locator('.app').evaluate(el => el.getBoundingClientRect().top);
    assert.equal(appTop, 40, 'アプリ本体は案内の下から始まる');
    await page.screenshot({ path: `${OUT}/inapp-banner.png` });
    await bar.locator('.inapp-open').click();
    const nav = await page.evaluate(() => window.__nav);
    assert.match(nav.at(-1)[1], /^intent:\/\/.*#Intent;scheme=http;package=com\.android\.chrome;end$/);
    assert.doesNotMatch(nav.at(-1)[1], /fallback/);
  });

  await test('「YouTubeで開く」は直接移動せず、アプリで開く／Chrome／コピーを選ぶ画面を出す', async () => {
    await playFirst(page);
    await sleep(600);
    await page.evaluate(() => { window.__nav = []; });
    await page.locator('.np-actions button[title="YouTubeで開く"]').click();
    await page.waitForSelector('.ext-modal');
    assert.deepEqual(await page.evaluate(() => window.__nav), [], 'window.open もページ移動もしない');
    const text = await page.locator('.ext-modal').innerText();
    assert.match(text, /X のアプリ内ブラウザ[\s\S]*戻れなくなる/);
    assert.match(text, /YouTube アプリで開く[\s\S]*Chrome で開く[\s\S]*リンクをコピー/);
    await page.screenshot({ path: `${OUT}/inapp-chooser.png` });
    await page.locator('.ext-choice', { hasText: 'YouTube アプリで開く' }).click();
    const nav = await page.evaluate(() => window.__nav);
    assert.equal(nav.length, 1, JSON.stringify(nav));
    assert.match(nav[0][1], /^intent:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}(&t=\d+s)?#Intent;scheme=https;package=com\.google\.android\.youtube;end$/);
    await sleep(300);
    assert.equal(await page.locator('.ext-modal').count(), 0);
  });

  await test('シアター上部には「YouTubeで開く」を置かない', async () => {
    await page.evaluate(() => import('/src/ui/theater.js').then(m => m.openTheater()));
    await page.waitForSelector('.theater');
    await sleep(500);
    assert.equal(await page.locator('.th-top [title="YouTubeで開く"]').count(), 0);
    assert.equal(await page.locator('.th-back').isVisible(), true);
    await page.locator('.th-back').click();
    await sleep(500);
  });

  await test('規約などの外部リンク（target=_blank）も選ぶ画面を経由する', async () => {
    await page.evaluate(() => { window.__nav = []; return import('/src/ui/privacy.js').then(m => m.openPrivacy()); });
    await page.waitForSelector('.privacy');
    await page.locator('.privacy a', { hasText: 'YouTube 利用規約' }).first().click();
    await page.waitForSelector('.ext-modal');
    assert.deepEqual(await page.evaluate(() => window.__nav), []);
    assert.match(await page.locator('.ext-modal .modal-title').innerText(), /YouTube 利用規約/);
    await page.locator('.ext-choice', { hasText: 'リンクをコピー' }).click().catch(() => {});
  });
  await ctx.close();
}

{
  const { ctx, page } = await openApp({ viewport: { width: 1280, height: 800 } });
  await test('普通のブラウザ: 案内は出さず、「YouTubeで開く」は別タブで開く', async () => {
    assert.equal(await page.locator('.inapp-bar').count(), 0);
    await playFirst(page);
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.__nav = []; });
    await page.locator('.np-actions button[title="YouTubeで開く"]').click();
    const nav = await page.evaluate(() => window.__nav);
    assert.equal(nav.length, 1);
    assert.equal(nav[0][0], 'open');
    assert.match(nav[0][1], /^https:\/\/www\.youtube\.com\/watch\?v=/);
    assert.equal(await page.locator('.ext-modal').count(), 0);
  });
  await ctx.close();
}

await browser.close();
await srv.close();
console.log(results.join('\n'));
if (errors.length) { console.log('errors:\n' + errors.join('\n')); failed++; }
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
