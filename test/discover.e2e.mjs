// 「セトリを探す」（YouTube Data API で概要欄・コメントから）の E2E。API はテスト用に代用
// 実行: node test/discover.e2e.mjs
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

const VIDEOS = {
  uvNqgBWckp4: {
    snippet: { title: '【歌枠】テスト配信', channelTitle: 'テストch', description: 'きてくれてありがとう！\n0:00 待機\n5:00 夜に駆ける / YOASOBI\n10:00 ドライフラワー / 優里\n#歌枠' },
    contentDetails: { duration: 'PT1H30M' }
  }
};
const COMMENTS = {
  uvNqgBWckp4: [
    { textDisplay: 'かわいい', authorDisplayName: 'a', likeCount: 500 },
    { textDisplay: 'セトリ\n5:00 夜に駆ける / YOASOBI\n10:00 ドライフラワー / 優里\n20:00 残酷な天使のテーゼ\n1:10:00 千本桜', authorDisplayName: 'セトリ職人', likeCount: 42 }
  ]
};

async function routeYouTubeApi(ctx, stats) {
  await ctx.route('https://www.googleapis.com/youtube/v3/**', (route) => {
    const url = new URL(route.request().url());
    const key = url.searchParams.get('key');
    const kind = url.pathname.split('/').pop();
    stats[kind] = (stats[kind] || 0) + 1;
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    if (key !== 'TESTKEY') return json(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'badRequest' }] } });
    const id = url.searchParams.get('id') || url.searchParams.get('videoId');
    if (id === 'mHSFy9Bbpew') return json(403, { error: { code: 403, message: 'quota', errors: [{ reason: 'quotaExceeded' }] } });
    if (kind === 'videos') return json(200, { items: VIDEOS[id] ? [VIDEOS[id]] : [] });
    if (kind === 'commentThreads') return json(200, { items: (COMMENTS[id] || []).map(c => ({ snippet: { topLevelComment: { snippet: c } } })) });
    return json(404, { error: { code: 404, errors: [{ reason: 'notFound' }] } });
  });
  await ctx.route('https://itunes.apple.com/search**', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"resultCount":0,"results":[]}' }));
}

async function test(name, fn) {
  try { await fn(); results.push(`ok   ${name}`); }
  catch (e) { failed++; results.push(`FAIL ${name}\n     ${e.message.split('\n')[0]}`); }
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ja-JP', serviceWorkers: 'block', acceptDownloads: true });
await routeThumbs(ctx);
const stats = {};
await routeYouTubeApi(ctx, stats);
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
page.on('console', m => { if (m.type() === 'error' && !/youtube\.com|fonts\.g|net::ERR|Failed to load resource|status of 4\d\d/.test(m.text())) errors.push(`[console] ${m.text()}`); });
await page.addInitScript({ content: 'window.__mock = { durations: {}, defaultDuration: 5400, latency: 100 };' });
await page.addInitScript({ content: fs.readFileSync(path.join(ROOT, 'test/helpers/mock-yt.js'), 'utf8') });
await page.goto(srv.base + '/index.html');
await page.waitForFunction(() => window.__uta && window.__uta.engine.ready, null, { timeout: 20000 });
await page.locator('.modal-footer .btn-primary').click().catch(() => {});
await page.waitForTimeout(200);
const sleep = (ms) => page.waitForTimeout(ms);
const openAdd = async (url) => {
  await page.evaluate((u) => { const dt = new DataTransfer(); dt.setData('text/plain', u); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, url);
  await page.waitForSelector('.add-modal');
  await sleep(400);
};
const closeModals = async () => { await page.keyboard.press('Escape'); await sleep(250); };

await test('キー未設定: 案内だけを表示し、API は呼ばない', async () => {
  await openAdd('https://www.youtube.com/watch?v=uvNqgBWckp4');
  assert.match(await page.locator('.finder').innerText(), /API キーを登録すると/);
  assert.equal(await page.locator('.finder-btn').count(), 0);
  assert.equal(stats.videos || 0, 0);
  await closeModals();
});

await test('概要欄とコメントからセトリ候補を見つけ、選ぶとセットリスト画面に入る（最後の曲は動画の長さまで）', async () => {
  await page.evaluate(() => window.__uta.store.setSetting('ytApiKey', 'TESTKEY'));
  await openAdd('https://www.youtube.com/watch?v=uvNqgBWckp4');
  await page.locator('.finder-btn').click();
  await page.waitForSelector('.finder-card');
  assert.equal(await page.locator('.finder-card').count(), 2);
  const first = await page.locator('.finder-card').nth(0).innerText();
  assert.match(first, /概要欄[\s\S]*2曲[\s\S]*曲以外 1件/);
  assert.match(await page.locator('.finder-card').nth(1).innerText(), /セトリ職人[\s\S]*4曲/);
  assert.equal(stats.videos, 1);
  assert.equal(stats.commentThreads, 1, '概要欄の候補が少ないのでコメントも読む');
  assert.ok(await page.locator('.finder-foot a', { hasText: 'YouTube 利用規約' }).count() >= 1);
  await page.screenshot({ path: `${OUT}/feature-discover.png` });
  await page.locator('.finder-card').nth(1).click();
  await page.waitForSelector('.setlist-table tbody tr');
  await sleep(600);
  assert.equal(await page.locator('.tab.on').innerText(), 'セットリスト貼り付け');
  assert.equal(await page.locator('.setlist-table tbody tr').count(), 4);
  assert.equal(await page.locator('.setlist-table tbody tr').nth(3).locator('td').nth(2).innerText(), '1:30:00', '最後の曲は動画の長さまで');
  await page.locator('.add-body .btn-primary').click();
  await sleep(400);
  const songs = await page.evaluate(() => window.__uta.store.currentPlaylist().songs.map(s => [s.title, s.start, s.end]));
  assert.deepEqual(songs.map(s => s[0]), ['夜に駆ける', 'ドライフラワー', '残酷な天使のテーゼ', '千本桜']);
  assert.equal(songs[3][2], 5400);
});

await test('概要欄の候補では「待機」などはチェックが外れ、同じ動画は再問い合わせしない', async () => {
  await openAdd('https://www.youtube.com/watch?v=uvNqgBWckp4');
  await page.locator('.tab', { hasText: 'セットリスト' }).click();
  await page.locator('.add-body input.input').first().fill('https://www.youtube.com/watch?v=uvNqgBWckp4');
  await page.waitForSelector('.finder-btn');
  await page.locator('.finder-btn').click();
  await page.waitForSelector('.finder-card');
  assert.equal(stats.videos, 1, 'cached for this session');
  await page.locator('.finder-card').first().click();
  await page.waitForSelector('.setlist-table tbody tr');
  assert.equal(await page.locator('.setlist-table tbody tr.unused').count(), 1);
  assert.equal(await page.locator('.setlist-table tbody tr.unused input.input').first().inputValue(), '待機');
  assert.match(await page.locator('.setlist-summary').innerText(), /2曲を取り込みます/);
  await closeModals();
});

await test('上限に達したときは理由と代わりの方法を表示', async () => {
  await openAdd('https://www.youtube.com/watch?v=mHSFy9Bbpew');
  await page.locator('.finder-btn').click();
  await page.waitForSelector('.finder .form-error');
  assert.match(await page.locator('.finder .form-error').innerText(), /今日の取得上限[\s\S]*概要欄をコピー/);
  await closeModals();
});

await test('設定: 接続テスト・不正なキーの案内・バックアップにキーを含めない・プライバシー表示', async () => {
  await page.locator('.side-link', { hasText: '設定' }).click();
  await sleep(300);
  assert.match(await page.locator('.settings').innerText(), /個人のキーを使用中/);
  await page.locator('.key-row .btn', { hasText: '接続テスト' }).click();
  await page.waitForSelector('.toast >> text=接続できました');
  await page.locator('.key-row input').fill('BADKEY');
  await page.locator('.key-row .btn', { hasText: '接続テスト' }).click();
  await page.waitForSelector('.toast-error >> text=APIキーが正しくありません');
  const json = await page.evaluate(() => window.__uta.store.exportJSON());
  assert.ok(!json.includes('BADKEY') && !json.includes('TESTKEY'), 'key not in backup');
  await page.locator('.settings .linklike', { hasText: 'プライバシーと利用規約' }).click();
  await sleep(300);
  assert.match(await page.locator('.privacy').innerText(), /YouTube API サービスを使用しています/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
});

await browser.close();
await srv.close();
console.log(results.join('\n'));
if (errors.length) { console.log('\nPAGE ERRORS:'); errors.forEach(e => console.log('  ' + e)); }
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
