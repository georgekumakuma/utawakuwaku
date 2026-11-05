// 曲間カット（原曲の長さで終わりを推定）の E2E。iTunes Search API はテスト用の偽カタログで代用
// 実行: node test/trim.e2e.mjs
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

const CATALOG = [
  { trackName: '夜に駆ける', artistName: 'YOASOBI', ms: 261000 },
  { trackName: '夜に駆ける (TV Size)', artistName: 'YOASOBI', ms: 89000 },
  { trackName: 'ドライフラワー', artistName: '優里', ms: 284000 },
  { trackName: '三年目の浮気', artistName: 'ヒロシ&キーボー', ms: 200000 },
  { trackName: 'ロリコンで良かった', artistName: 'イトーヨーカドー', ms: 150000 }
];
const nrm = (s) => String(s).normalize('NFKC').toLowerCase().replace(/\s+/g, '');

async function routeItunes(ctx, { cors, stats, rateLimitFirst = false }) {
  let first = true;
  await ctx.route('https://itunes.apple.com/search**', (route) => {
    const url = new URL(route.request().url());
    const term = nrm(url.searchParams.get('term') || '');
    const cb = url.searchParams.get('callback');
    stats.calls++;
    if (cb) stats.jsonp++;
    // CORS で弾かれたときと同じく、fetch を失敗させる（Playwright の偽レスポンスには CORS 検査がかからないため）
    if (!cors && !cb) { stats.blocked = (stats.blocked || 0) + 1; return route.abort('failed'); }
    if (rateLimitFirst && first) { first = false; stats.limited++; return route.fulfill({ status: 403, headers: cors ? { 'Access-Control-Allow-Origin': '*' } : {}, body: 'rate limited' }); }
    const hits = CATALOG.filter(t => term.includes(nrm(t.trackName).replace(/\(.*\)/, '')) || nrm(t.trackName).includes(term.split(/(?=[a-z])/)[0]))
      .map(t => ({ kind: 'song', trackName: t.trackName, artistName: t.artistName, collectionName: 'X', trackTimeMillis: t.ms }));
    const json = JSON.stringify({ resultCount: hits.length, results: hits });
    if (cb) return route.fulfill({ status: 200, contentType: 'text/javascript', body: `${cb}(${json});` });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors ? { 'Access-Control-Allow-Origin': '*' } : {}, body: json });
  });
}

async function newPage({ cors = true, rateLimitFirst = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP', serviceWorkers: 'block' });
  await routeThumbs(ctx);
  const stats = { calls: 0, jsonp: 0, limited: 0 };
  await routeItunes(ctx, { cors, stats, rateLimitFirst });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/youtube|fonts\.g|net::ERR|Failed to load resource|CORS|Access-Control/.test(m.text())) errors.push(`[console] ${m.text()}`); });
  await page.addInitScript({ content: 'window.__mock = { durations: {}, defaultDuration: 5400, latency: 100 };' });
  await page.addInitScript({ content: fs.readFileSync(path.join(ROOT, 'test/helpers/mock-yt.js'), 'utf8') });
  await page.goto(srv.base + '/index.html');
  await page.waitForFunction(() => window.__uta && window.__uta.engine.ready, null, { timeout: 20000 });
  await page.locator('.modal-footer .btn-primary').click().catch(() => {});
  await page.waitForTimeout(200);
  return { ctx, page, stats };
}
async function test(name, fn) {
  try { await fn(); results.push(`ok   ${name}`); }
  catch (e) { failed++; results.push(`FAIL ${name}\n     ${e.message.split('\n')[0]}`); }
}

const SETLIST = 'https://www.youtube.com/watch?v=uvNqgBWckp4\n0:10 夜に駆ける / YOASOBI\n6:00 ドライフラワー / 優里\n10:00 謎の新曲';

async function pasteSetlist(page) {
  await page.evaluate((text) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, SETLIST);
  await page.waitForSelector('.setlist-table tbody tr');
}

{
  const { ctx, page, stats } = await newPage({ cors: true, rateLimitFirst: true });

  await test('セットリスト取り込み: 原曲の長さで終わりを推定してカット（制限にかかっても再試行）', async () => {
    await pasteSetlist(page);
    await page.waitForFunction(() => /曲の終わりを推定/.test(document.querySelector('.trim-status')?.textContent || ''), null, { timeout: 30000 });
    const rows = await page.locator('.setlist-table tbody tr').evaluateAll(trs => trs.map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText || td.querySelector('input')?.value || '')));
    // 夜に駆ける: 0:10 + 4:21 + 5 = 4:36（次の曲 6:00 まで → 1:24 カット）
    assert.equal(rows[0][2], '4:36');
    assert.equal(rows[0][5], '−1:24');
    // ドライフラワー: 6:00 + 4:44 + 5 = 10:49 > 次の曲 10:00 → 変更なし
    assert.equal(rows[1][2], '10:00');
    assert.equal(rows[1][5], '原曲 4:44');
    // 見つからない曲はそのまま
    assert.equal(rows[2][5], '見つからず');
    assert.match(await page.locator('.trim-status').innerText(), /1曲の終わりを推定（合計 1:24 カット）/);
    assert.equal(stats.limited, 1, 'one rate-limited response');
    await page.screenshot({ path: `${OUT}/feature-trim-setlist.png` });
    // 余韻を変えると即座に再計算（通信なし）
    const before = stats.calls;
    await page.locator('.trim-opts input[type=number]').fill('0');
    await page.locator('.trim-opts input[type=number]').dispatchEvent('change');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.setlist-table tbody tr').first().locator('td').nth(2).innerText(), '4:31');
    assert.equal(stats.calls, before);
    // 取り込み
    await page.locator('.add-body .btn-primary').click();
    await page.waitForTimeout(400);
    const ends = await page.evaluate(() => window.__uta.store.currentPlaylist().songs.map(s => s.end));
    assert.deepEqual(ends, [271, 600, 0]);
    await page.evaluate(() => window.__uta.store.setSetting('trimTail', 5));
  });

  await test('スイッチをオフにすると推定を使わない', async () => {
    await pasteSetlist(page);
    await page.locator('.trim-opts .check input').uncheck();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.setlist-table tbody tr').first().locator('td').nth(2).innerText(), '6:00');
    assert.equal(await page.locator('.trim-status').innerText(), '');
    await page.locator('.trim-opts .check input').check();
    await page.waitForTimeout(200);
    assert.equal(await page.locator('.setlist-table tbody tr').first().locator('td').nth(2).innerText(), '4:36', 'cached result reused');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });

  await test('区間エディタ: 「原曲の長さで」ボタンで終わりを詰める', async () => {
    await page.locator('.side-pl', { hasText: 'マイリスト' }).click();
    await page.waitForTimeout(300);
    await page.locator('.row').first().click({ button: 'right' });
    await page.locator('.menu-item', { hasText: '編集' }).click();
    await page.waitForTimeout(300);
    const endInput = page.locator('.time-row').nth(1).locator('.time-input');
    assert.equal(await endInput.inputValue(), '18:16.0');
    await page.locator('.panel-editor .btn', { hasText: '原曲の長さで' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.time-row')[1].querySelector('.time-input').value !== '18:16.0', null, { timeout: 15000 });
    // 14:21 (861) + 3:20 (200) + 5 = 1066 = 17:46
    assert.equal(await endInput.inputValue(), '17:46.0');
    assert.ok(await page.locator('.toast', { hasText: '三年目の浮気' }).count() >= 1);
    await page.keyboard.press('Escape');
  });

  await test('プレイリスト全体の曲間を詰める（確認画面・元に戻す）', async () => {
    await page.evaluate(() => window.__uta.store.createPlaylist('詰めるテスト', [
      { videoId: 'uvNqgBWckp4', title: '三年目の浮気', start: 861, end: 1096 },
      { videoId: 'uvNqgBWckp4', title: 'ロリコンで良かった', start: 1134, end: 1343 },
      { videoId: 'mHSFy9Bbpew', title: '知らない曲', start: 0, end: 300 }
    ]));
    await page.waitForTimeout(300);
    await page.locator('.view-actions .btn[title="メニュー"]').click();
    await page.locator('.menu-item', { hasText: '曲間を詰める' }).click();
    await page.waitForFunction(() => /曲を変更/.test(document.querySelector('.trim-dialog .trim-status')?.textContent || ''), null, { timeout: 20000 });
    assert.match(await page.locator('.trim-dialog .trim-status').innerText(), /2曲を変更（合計 1:24 カット）/);
    await page.screenshot({ path: `${OUT}/feature-trim-dialog.png` });
    await page.locator('.modal-footer .btn-primary').click();
    await page.waitForTimeout(300);
    let ends = await page.evaluate(() => window.__uta.store.currentPlaylist().songs.map(s => s.end));
    assert.deepEqual(ends, [1066, 1289, 300]);
    await page.locator('.toast-action', { hasText: '元に戻す' }).click();
    await page.waitForTimeout(200);
    ends = await page.evaluate(() => window.__uta.store.currentPlaylist().songs.map(s => s.end));
    assert.deepEqual(ends, [1096, 1343, 300]);
  });
  await ctx.close();
}

{
  const { ctx, page, stats } = await newPage({ cors: false });
  await test('ブラウザが直接の読み込みを許さない場合は JSONP に切り替えて推定できる', async () => {
    await pasteSetlist(page);
    await page.waitForFunction(() => /曲の終わりを推定/.test(document.querySelector('.trim-status')?.textContent || ''), null, { timeout: 30000 });
    assert.equal(await page.locator('.setlist-table tbody tr').first().locator('td').nth(2).innerText(), '4:36');
    assert.ok(stats.jsonp >= 2, `JSONP used: ${JSON.stringify(stats)}`);
  });
  await ctx.close();
}

await browser.close();
await srv.close();
console.log(results.join('\n'));
if (errors.length) { console.log('\nPAGE ERRORS:'); errors.forEach(e => console.log('  ' + e)); }
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
