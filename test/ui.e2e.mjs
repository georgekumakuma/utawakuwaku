// UI の E2E スモークテスト（実ブラウザ・YouTube API なし）
// 実行: node test/ui.e2e.mjs   （スクリーンショットは test/.shots/ に保存）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, getPlaywright, ROOT } from './helpers/server.mjs';

const OUT = path.join(ROOT, 'test', '.shots');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = await getPlaywright();
const srv = await startServer();
const browser = await chromium.launch();
const errors = [];
const results = [];
let failed = 0;

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'ja-JP', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error' && !/ytimg|youtube|favicon|fonts\.g|net::ERR|Failed to load resource/.test(m.text())) errors.push(`[console] ${m.text()}`);
  });
  await page.goto(srv.base + '/index.html');
  await page.waitForFunction(() => !!window.__uta, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  await page.locator('.modal-footer .btn-primary').click().catch(() => {});
  await page.waitForTimeout(200);
  return { ctx, page };
}
async function test(name, fn) {
  try { await fn(); results.push(`ok   ${name}`); }
  catch (e) { failed++; results.push(`FAIL ${name}\n     ${e.message}`); }
}

// ---------- Desktop ----------
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 });
  const sleep = (ms) => page.waitForTimeout(ms);

  await test('初回起動でデフォルトプレイリストが読み込まれ、仮想リストが描画される', async () => {
    assert.match(await page.locator('.view-title').innerText(), /マイリスト/);
    assert.match(await page.locator('.view-meta').innerText(), /65曲/);
    const rows = await page.locator('.row').count();
    assert.ok(rows > 5 && rows < 40, `virtualized rows: ${rows}`);
    await page.screenshot({ path: `${OUT}/desktop-playlist.png` });
  });

  await test('検索で絞り込める', async () => {
    await page.locator('.search-input').fill('ニコニコ');
    await sleep(300);
    assert.match(await page.locator('.view-meta').innerText(), /件を表示/);
    assert.ok(await page.locator('.row mark').count() > 0, 'highlight');
    await page.locator('.search-input').fill('');
    await sleep(300);
  });

  await test('右クリックメニューと編集パネル（E キー）', async () => {
    await page.locator('.row').first().click({ button: 'right' });
    await sleep(150);
    assert.ok(await page.locator('.menu-item').count() >= 8);
    await page.keyboard.press('Escape');
    await page.locator('.row').nth(1).click();
    await page.locator('.view-list.songlist').focus();
    await page.keyboard.press('e');
    await sleep(300);
    assert.ok(await page.locator('.panel-editor').isVisible());
    assert.equal(await page.locator('.panel-editor .panel-title').innerText(), '曲を編集');
    const endInput = page.locator('.time-row').nth(1).locator('.time-input');
    const before = await endInput.inputValue();
    await page.locator('.time-row').nth(1).locator('.btn.xs').nth(4).click();
    assert.notEqual(await endInput.inputValue(), before, 'nudge changed end');
    await page.locator('.panel-foot .btn-primary').click();
    await sleep(200);
    assert.ok(await page.locator('.toast', { hasText: '保存しました' }).count() >= 1);
    await page.screenshot({ path: `${OUT}/desktop-editor.png` });
    await page.keyboard.press('Escape');
  });

  await test('ライブラリ・バンク・プリセット読み込み', async () => {
    await page.locator('.side-item', { hasText: 'ライブラリ' }).click();
    await sleep(300);
    assert.match(await page.locator('.view-meta').innerText(), /65曲/);
    await page.locator('.side-item', { hasText: 'バンク' }).click();
    await sleep(1000);
    assert.equal(await page.locator('.bank-section', { hasText: 'サンプル' }).locator('.bank-card').count(), 6);
    assert.equal(await page.locator('.bank-empty').count(), 1, 'empty shared-bank prompt');
    await page.screenshot({ path: `${OUT}/desktop-bank.png` });
    await page.locator('.bank-card', { hasText: 'Pops' }).locator('.btn-primary').click();
    await sleep(600);
    assert.match(await page.locator('.view-title').innerText(), /Pops/);
    assert.match(await page.locator('.view-meta').innerText(), /12曲/);
  });

  await test('セットリスト貼り付けで新規プレイリストを作成', async () => {
    await page.locator('.topbar-add').click();
    await sleep(200);
    await page.locator('.tab', { hasText: 'セットリスト' }).click();
    await page.locator('.add-body input.input').first().fill('https://www.youtube.com/watch?v=uvNqgBWckp4');
    await page.locator('.setlist-ta').fill('0:12 ドライフラワー / 優里\n4:30 夜に駆ける - YOASOBI\n9:01 ～ 12:40 「残酷な天使のテーゼ」');
    await sleep(500);
    assert.equal(await page.locator('.setlist-table tbody tr').count(), 3);
    await page.screenshot({ path: `${OUT}/desktop-setlist.png` });
    await page.locator('.add-body .btn-primary').click();
    await sleep(400);
    assert.match(await page.locator('.view-meta').innerText(), /3曲/);
  });

  await test('コマンドパレットで曲を横断検索', async () => {
    await page.keyboard.press('Control+k');
    await sleep(200);
    await page.locator('.palette-input').fill('夜に');
    await sleep(200);
    assert.ok(await page.locator('.palette-item.song').count() >= 1);
    await page.screenshot({ path: `${OUT}/desktop-palette.png` });
    await page.keyboard.press('Escape');
  });

  await test('統計ビュー・同じ曲の別バージョン・タグ候補', async () => {
    await page.evaluate(() => {
      const { store } = window.__uta;
      store.createPlaylist('版違い', [
        { videoId: 'uvNqgBWckp4', title: '夜に駆ける', start: 0, end: 60, article: '【歌枠】テスト【ボカロ】', singer: '歌い手A' },
        { videoId: 'mHSFy9Bbpew', title: '夜に駆ける (short ver.)', start: 0, end: 30, singer: '歌い手B' }
      ]);
    });
    await sleep(300);
    await page.locator('.row').first().click({ button: 'right' });
    await sleep(150);
    const v = page.locator('.menu-item', { hasText: '他のバージョン' });
    assert.equal(await v.count(), 1);
    await v.click();
    await sleep(300);
    assert.match(await page.locator('.view-title').innerText(), /ライブラリ/);
    const titles = await page.locator('.row .row-title').allInnerTexts();
    assert.ok(titles.length >= 2, `versions shown: ${titles}`);
    assert.ok(titles.every(t => t.startsWith('夜に駆ける')), JSON.stringify(titles));
    assert.ok(await page.locator('.filter-pill').count() === 1);
    await page.locator('.filter-pill button').click();
    await sleep(200);
    await page.locator('.side-item', { hasText: '統計' }).click();
    await sleep(300);
    assert.ok(await page.locator('.stat-tile').count() >= 4);
    assert.equal(await page.locator('.chart-card').count(), 6);
    assert.match(await page.locator('.chart-card', { hasText: '歌い手' }).innerText(), /歌い手A/);
    await page.screenshot({ path: `${OUT}/desktop-stats.png` });
    await page.locator('.side-pl', { hasText: '版違い' }).click();
    await sleep(200);
    await page.locator('.view-list.songlist').focus();
    await page.locator('.row').first().click({ button: 'right' });
    await page.locator('.menu-item', { hasText: '編集' }).click();
    await sleep(300);
    const sugg = await page.locator('.tag-suggest .chip').allInnerTexts();
    assert.deepEqual(sugg, ['+歌枠', '+ボカロ']);
    await page.locator('.tag-suggest .chip').first().click();
    assert.equal(await page.locator('.panel-editor input[placeholder^="タグ"]').inputValue(), '歌枠');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });

  await test('スリープタイマーのメニュー', async () => {
    await page.locator('.pb-sleep').click();
    await sleep(150);
    await page.locator('.menu-item', { hasText: '30分後' }).click();
    await sleep(150);
    assert.equal(await page.locator('.pb-sleep-badge').innerText(), '30');
    await page.locator('.pb-sleep').click();
    await page.locator('.menu-item', { hasText: '解除' }).click();
    await sleep(150);
    assert.equal(await page.evaluate(() => window.__uta.state.ui.sleep), null);
  });

  await test('共有バンク: URLで追加 → 読み込み → 最新版で更新 → 紹介リンク → 一覧から外す', async () => {
    const csvUrl = srv.base + '/playlists/samples/utawaku_best_cute.csv';
    const bankUrl = srv.base + '/playlists/samples/playlistbank.json';
    await page.locator('.side-item', { hasText: 'バンク' }).click();
    await sleep(300);
    // CSV 1本の共有バンク
    await page.locator('.view-actions .btn', { hasText: 'URLでバンクを追加' }).click();
    await sleep(200);
    await page.locator('.addbank input[type=url]').fill(csvUrl);
    await page.locator('.addbank .btn', { hasText: '確認' }).click();
    await page.waitForSelector('.inspect-ok');
    assert.match(await page.locator('.inspect-ok').innerText(), /14曲/);
    await page.locator('.addbank input[type=text]').fill('テスト共有');
    await page.locator('.modal-footer .btn-primary').click();
    await sleep(300);
    const mine = page.locator('.bank-section', { hasText: '追加した共有バンク' });
    assert.equal(await mine.locator('.bank-card', { hasText: 'テスト共有' }).count(), 1);
    await mine.locator('.bank-card', { hasText: 'テスト共有' }).locator('.btn-primary').click();
    await sleep(500);
    assert.match(await page.locator('.view-title').innerText(), /テスト共有/);
    assert.match(await page.locator('.view-meta').innerText(), /14曲/);
    // 自分で編集（1曲削除）→ 最新版で更新で元に戻る
    await page.locator('.row').first().click({ button: 'right' });
    await page.locator('.menu-item', { hasText: '削除' }).click();
    await sleep(200);
    assert.match(await page.locator('.view-meta').innerText(), /13曲/);
    await page.locator('.view-actions .btn[title="メニュー"]').click();
    await page.locator('.menu-item', { hasText: '最新版で更新' }).click();
    await page.locator('.modal .btn-danger').click();
    await sleep(500);
    assert.match(await page.locator('.view-meta').innerText(), /14曲/);
    // スプレッドシート用コピー
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('.view-actions .btn[title="メニュー"]').click();
    await page.locator('.menu-item', { hasText: 'スプレッドシート用' }).click();
    await sleep(200);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(clip.startsWith('videoId\ttitle\tstart'), clip.slice(0, 40));
    assert.equal(clip.split('\n').length, 15);
    // playlistbank.json 形式の共有バンク（相対パスの解決）
    await page.locator('.side-item', { hasText: 'バンク' }).click();
    await sleep(200);
    await page.locator('.view-actions .btn', { hasText: 'URLでバンクを追加' }).click();
    await page.locator('.addbank input[type=url]').fill(bankUrl);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.inspect-ok');
    assert.match(await page.locator('.inspect-ok').innerText(), /6個のプレイリスト/);
    await page.locator('.addbank input[type=text]').fill('テストバンク');
    await page.locator('.modal-footer .btn-primary').click();
    await sleep(300);
    assert.equal(await page.locator('.bank-card.bank-sub').count(), 6);
    await page.locator('.bank-card.bank-sub', { hasText: 'Ballad' }).locator('.btn-primary').click();
    await sleep(500);
    assert.match(await page.locator('.view-meta').innerText(), /13曲/);
    await page.screenshot({ path: `${OUT}/desktop-sharedbank-loaded.png` });
    // 紹介リンク（#bank=）で開くと追加ダイアログが出る
    await page.evaluate(() => { location.hash = '#bank=' + encodeURIComponent(location.origin + '/playlists/samples/utawaku_best_pops.csv'); });
    await page.waitForSelector('.inspect-ok');
    assert.match(await page.locator('.inspect-ok').innerText(), /12曲/);
    await page.keyboard.press('Escape');
    await sleep(200);
    // 一覧から外す → 元に戻す
    await page.locator('.side-item', { hasText: 'バンク' }).click();
    await sleep(300);
    await page.screenshot({ path: `${OUT}/desktop-sharedbank.png`, fullPage: false });
    const before = await page.locator('.bank-section', { hasText: '追加した共有バンク' }).locator('.bank-card').count();
    await page.locator('.bank-card', { hasText: 'テスト共有' }).locator('.icon-btn[title="メニュー"]').click();
    await page.locator('.menu-item', { hasText: '一覧から外す' }).click();
    await sleep(200);
    assert.equal(await page.locator('.bank-section', { hasText: '追加した共有バンク' }).locator('.bank-card').count(), before - 1);
    await page.locator('.toast-action', { hasText: '元に戻す' }).click();
    await sleep(200);
    assert.equal(await page.locator('.bank-section', { hasText: '追加した共有バンク' }).locator('.bank-card').count(), before);
    // エラー表示: HTML が返る URL
    await page.locator('.view-actions .btn', { hasText: 'URLでバンクを追加' }).click();
    await page.locator('.addbank input[type=url]').fill(srv.base + '/index.html');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.bank-inspect .form-error');
    assert.match(await page.locator('.bank-inspect .form-error').innerText(), /ウェブに公開/);
    await page.keyboard.press('Escape');
  });

  await test('みんなの共有バンク（作者が紹介する一覧）', async () => {
    await page.route('**/playlists/shared-directory.json', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ banks: [{ name: '紹介バンク', description: '説明', author: 'ファンA', url: srv.base + '/playlists/samples/utawaku_best_pops.csv' }] })
    }));
    await page.reload();
    await page.waitForFunction(() => !!window.__uta, null, { timeout: 20000 });
    await sleep(300);
    await page.locator('.side-item', { hasText: 'バンク' }).click();
    const dir = page.locator('.bank-section', { hasText: 'みんなの共有バンク' });
    await dir.locator('.bank-card').first().waitFor();
    assert.match(await dir.innerText(), /紹介バンク[\s\S]*ファンA/);
    await dir.locator('.btn', { hasText: '追加' }).click();
    await page.waitForSelector('.inspect-ok');
    await page.locator('.addbank input[type=text]').fill('紹介バンク');
    await page.locator('.modal-footer .btn-primary').click();
    await sleep(300);
    assert.match(await dir.innerText(), /追加済み/);
    await page.unroute('**/playlists/shared-directory.json');
  });

  await test('設定（テーマ切替）とリロード後の永続化', async () => {
    await page.locator('.side-link', { hasText: '設定' }).click();
    await sleep(200);
    await page.locator('.settings select.select').selectOption('light');
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.screenshot({ path: `${OUT}/desktop-light.png` });
    await page.reload();
    await page.waitForFunction(() => !!window.__uta, null, { timeout: 20000 });
    await sleep(500);
    const pls = (await page.locator('.side-pl').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
    assert.ok(pls.length >= 6, JSON.stringify(pls));
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  });

  await test('旧バージョンの localStorage データが移行される', async () => {
    await page.evaluate(() => {
      localStorage.setItem('utawakuwaku_playlists_v2', JSON.stringify({ current: '旧リスト', lists: { '旧リスト': [{ videoId: 'uvNqgBWckp4', title: '旧曲', start: 1, end: 2, rating: 4, article: '' }] } }));
      return new Promise(r => { const req = indexedDB.deleteDatabase('utawakuwaku'); req.onsuccess = req.onerror = req.onblocked = () => r(); });
    });
    await page.reload();
    await page.waitForFunction(() => !!window.__uta, null, { timeout: 20000 });
    await sleep(500);
    assert.match(await page.locator('.view-title').innerText(), /旧リスト/);
    assert.ok(await page.locator('.toast', { hasText: '移行' }).count() >= 1);
  });
  await ctx.close();
}

// ---------- Mobile ----------
{
  const { ctx, page } = await newPage({ width: 390, height: 844 });
  await test('モバイル: シーン名優先の行表示・ドロワー・編集シート', async () => {
    await page.screenshot({ path: `${OUT}/mobile-playlist.png` });
    const t = (await page.locator('.row').first().innerText()).replace(/\s+/g, ' ').trim();
    assert.ok(!/[\w-]{11}/.test(t.split(' ')[0]), 'first token is a title, not a video id: ' + t);
    assert.ok(await page.locator('.row-idx').first().isHidden(), 'index hidden on phone');
    await page.locator('.menu-toggle').click();
    await page.waitForTimeout(300);
    assert.ok(await page.locator('.sidebar').isVisible());
    await page.screenshot({ path: `${OUT}/mobile-drawer.png` });
    await page.locator('.drawer-backdrop').click({ position: { x: 370, y: 400 } });
    await page.waitForTimeout(300);
    await page.locator('.row').first().locator('.row-more').click();
    await page.locator('.menu-item', { hasText: '編集' }).click();
    await page.waitForTimeout(300);
    assert.ok(await page.locator('.panel-editor').isVisible());
    await page.screenshot({ path: `${OUT}/mobile-editor.png` });
  });
  await ctx.close();
}

await browser.close();
await srv.close();
console.log(results.join('\n'));
if (errors.length) { console.log('\nPAGE ERRORS:'); errors.forEach(e => console.log('  ' + e)); }
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
