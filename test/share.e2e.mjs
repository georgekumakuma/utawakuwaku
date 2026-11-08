// 共有URL（短い p3 形式）の作成・取り込み、バンク追加画面での案内、長いときの案内の E2E
// 実行: node test/share.e2e.mjs
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

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ja-JP', serviceWorkers: 'block' });
await routeThumbs(ctx);
let oembedCalls = 0;
await ctx.route('https://www.youtube.com/oembed**', (route) => {
  oembedCalls++;
  const id = new URL(new URL(route.request().url()).searchParams.get('url')).searchParams.get('v');
  route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ title: `配信 ${id}`, author_name: 'ch' }) });
});
await ctx.addInitScript({ content: `
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied.push(t); } } });
  window.__mock = { durations: {}, defaultDuration: 9000, latency: 50 };` });
await ctx.addInitScript({ content: fs.readFileSync(path.join(ROOT, 'test/helpers/mock-yt.js'), 'utf8') });

async function open(url) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/youtube\.com|fonts\.g|net::ERR|Failed to load resource|status of 4\d\d/.test(m.text())) errors.push(`[console] ${m.text()}`); });
  await page.goto(url);
  await page.waitForFunction(() => window.__uta && window.__uta.engine.ready, null, { timeout: 20000 });
  return page;
}

const page = await open(srv.base + '/index.html');
await page.locator('.modal-footer .btn-primary').click().catch(() => {});
await page.waitForTimeout(300);
const sleep = (ms) => page.waitForTimeout(ms);

// シーン検出で作られたような 78 件（同じ動画に複数、自動のシーン名、60秒、長い配信タイトル）
await page.evaluate(() => {
  // 実際の動画IDのようにランダム（圧縮が効きすぎないように）
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const ids = Array.from({ length: 60 }, () => Array.from({ length: 11 }, () => A[Math.floor(rnd() * 64)]).join(''));
  const songs = Array.from({ length: 78 }, (_, i) => {
    const id = ids[i % 60]; const st = 300 + i * 113;
    const h = Math.floor(st / 3600), m = Math.floor(st % 3600 / 60), s = st % 60, p = (n) => String(n).padStart(2, '0');
    return { videoId: id, title: `${id}_${h ? `${h}h${p(m)}m` : `${m}m`}${p(s)}s`, start: st, end: st + 60, rating: 5, article: '【ゲーム実況】とても長い配信タイトルがここに入ります！！完全初見プレイ #' + i };
  });
  window.__uta.store.createPlaylist('ダジャレ集', songs);
});

let shareUrl = '';
await test('78件のシーン集でも共有URLは短く（2,000文字以内）、そのままコピーされる', async () => {
  const pl = await page.evaluate(() => window.__uta.store.currentPlaylist());
  assert.equal(pl.name, 'ダジャレ集');
  await page.evaluate((id) => window.__uta.actions.sharePlaylist(id), pl.id);
  await page.waitForSelector('.toast >> text=共有URLをコピーしました');
  shareUrl = await page.evaluate(() => window.__copied.at(-1));
  assert.match(shareUrl, /#p3=/);
  assert.ok(shareUrl.length < 2000, `length ${shareUrl.length}`);
  results.push(`     (共有URL ${shareUrl.length} 文字)`);
});

await test('共有URLを開くと確認のうえ取り込み、配信タイトルは YouTube から補う', async () => {
  const p2 = await open(shareUrl);
  await p2.waitForSelector('.modal-title >> text=共有プレイリスト');
  assert.match(await p2.locator('.modal').innerText(), /ダジャレ集」（78曲）/);
  await p2.locator('.modal-footer .btn-primary').click();
  await p2.waitForFunction(() => { const pl = window.__uta.store.currentPlaylist(); return pl && pl.name.startsWith('ダジャレ集') && pl.songs.every(s => s.article); }, null, { timeout: 10000 });
  const songs = await p2.evaluate(() => window.__uta.store.currentPlaylist().songs);
  assert.equal(songs.length, 78);
  assert.equal(songs[1].title, songs[1].videoId + '_' + '6m53s');
  assert.equal(songs[1].end - songs[1].start, 60);
  assert.equal(songs[0].article, `配信 ${songs[0].videoId}`);
  assert.equal(oembedCalls, 60, '動画ごとに1回だけ問い合わせる');
  await p2.close();
});

await test('「URLでバンクを追加」に共有URLを貼ると、プレイリストとして取り込む案内を出す', async () => {
  await page.evaluate(() => window.__uta.store.setView('bank'));
  await sleep(300);
  await page.locator('button', { hasText: 'URLでバンクを追加' }).first().click();
  await page.waitForSelector('.modal input.input');
  await page.locator('.modal input.input').first().fill(shareUrl);
  await page.locator('.modal button', { hasText: '確認' }).click();
  await page.waitForSelector('.bank-inspect >> text=プレイリストの共有URLです');
  assert.doesNotMatch(await page.locator('.bank-inspect').innerText(), /Google|登録できません。$/);
  await page.screenshot({ path: `${OUT}/share-in-bank-dialog.png` });
  await page.locator('.bank-inspect button', { hasText: 'プレイリストとして取り込む' }).click();
  await page.waitForSelector('.modal-title >> text=共有プレイリスト');
  await sleep(300);
  assert.equal(await page.locator('.modal-title', { hasText: 'URLでバンクを追加' }).count(), 0, 'バンク追加画面は閉じる');
  await page.locator('.modal-footer .btn-ghost').click(); // キャンセル
  await sleep(300);
});

await test('入力欄の外に共有URLを貼り付けても取り込みの確認が出る', async () => {
  await page.evaluate((u) => { const dt = new DataTransfer(); dt.setData('text/plain', u); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, shareUrl);
  await page.waitForSelector('.modal-title >> text=共有プレイリスト');
  await page.locator('.modal-footer .btn-ghost').click();
  await sleep(300);
});

await test('それでも長いときは、分ける・共有バンクにする方法を案内する', async () => {
  const id = await page.evaluate(() => {
    const songs = Array.from({ length: 160 }, (_, i) => ({ videoId: ('L' + i + 'qwertyuiopasdf').slice(0, 11), title: `とても長い曲名のサンプル その${i}（アコースティック ver.）`, start: i * 31, end: i * 31 + 200, rating: 4 }));
    return window.__uta.store.createPlaylist('大きなリスト', songs).id;
  });
  await page.evaluate((pid) => window.__uta.actions.sharePlaylist(pid), id);
  await page.waitForSelector('.modal-title >> text=共有URLが長くなりました');
  const text = await page.locator('.share-long').innerText();
  assert.match(text, /160曲[\s\S]*文字[\s\S]*分ける[\s\S]*共有バンク/);
  await page.screenshot({ path: `${OUT}/share-long.png` });
  await page.locator('.modal-footer .btn-primary', { hasText: 'それでもURLをコピー' }).click();
  await page.waitForSelector('.toast >> text=共有URLをコピーしました');
  assert.match(await page.evaluate(() => window.__copied.at(-1)), /#p3=/);
});

await browser.close();
await srv.close();
console.log(results.join('\n'));
if (errors.length) { console.log('errors:\n' + errors.join('\n')); failed++; }
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
