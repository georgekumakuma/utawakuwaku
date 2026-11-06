// v3 の体験機能の E2E: アートワーク色・シアター・イントロクイズ・ラジオ・配信アーカイブ・どこでも貼り付け/ドロップ
// 実行: node test/features.e2e.mjs
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

async function newPage(viewport = { width: 1440, height: 900 }, extra = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'ja-JP', serviceWorkers: 'block', ...extra });
  await routeThumbs(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/youtube|fonts\.g|net::ERR|Failed to load resource/.test(m.text())) errors.push(`[console] ${m.text()}`); });
  await page.addInitScript({ content: 'window.__mock = { durations: {}, defaultDuration: 5400, latency: 100 };' });
  await page.addInitScript({ content: fs.readFileSync(path.join(ROOT, 'test/helpers/mock-yt.js'), 'utf8') });
  await page.goto(srv.base + '/index.html');
  await page.waitForFunction(() => window.__uta && window.__uta.engine.ready, null, { timeout: 20000 });
  await page.locator('.modal-footer .btn-primary').click().catch(() => {});
  await page.waitForTimeout(200);
  return { ctx, page };
}
async function test(name, fn) {
  try { await fn(); results.push(`ok   ${name}`); }
  catch (e) { failed++; results.push(`FAIL ${name}\n     ${e.message.split('\n')[0]}`); }
}
const waitFor = (page, fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout });

{
  const { ctx, page } = await newPage();
  const sleep = (ms) => page.waitForTimeout(ms);

  await test('アートワーク色: 再生中の曲のサムネイルからアクセントカラーが変わる', async () => {
    const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    await page.locator('.row').nth(2).click();
    await waitFor(page, () => document.documentElement.dataset.artwork === 'on');
    await sleep(1400);
    const after = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    assert.notEqual(after, before);
    assert.equal(await page.locator('.stage-glow i.on').count(), 1, 'ambient glow layer');
    // 設定でオフにするとテーマの色に戻る
    await page.evaluate(() => window.__uta.store.setSetting('artworkColor', false));
    await sleep(100);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.artwork), 'off');
    await page.evaluate(() => window.__uta.store.setSetting('artworkColor', true));
  });

  await test('シアターモード: 動画が枠に移動し、次の曲カードから再生でき、Esc で戻る', async () => {
    await page.keyboard.press('t');
    await page.waitForSelector('.theater.show');
    await sleep(900);
    const r = await page.evaluate(() => {
      const v = document.querySelector('.stage-video').getBoundingClientRect();
      const s = document.querySelector('.th-slot').getBoundingClientRect();
      return [Math.abs(v.x - s.x), Math.abs(v.y - s.y), Math.abs(v.width - s.width), Math.abs(v.height - s.height)];
    });
    assert.ok(r.every(d => d < 2), `video sits in the slot: ${r}`);
    assert.equal(await page.locator('.th-card').count(), 5);
    assert.match(await page.locator('.th-title').getAttribute('aria-label'), /\S/);
    const target = await page.locator('.th-card b').nth(1).innerText();
    await page.locator('.th-card').nth(1).click();
    await waitFor(page, (t) => window.__uta.engine.state.song.title === t && window.__uta.engine.state.status === 'playing', target);
    await sleep(400);
    assert.equal(await page.locator('.th-title').getAttribute('aria-label'), target);
    await page.screenshot({ path: `${OUT}/feature-theater.png` });
    // 映像オフでアートワーク表示
    await page.keyboard.press('v');
    await sleep(300);
    assert.equal(await page.locator('.theater.show-video').count(), 0);
    await page.keyboard.press('v');
    await page.keyboard.press('Escape');
    await sleep(700);
    assert.equal(await page.locator('.theater').count(), 0);
    assert.equal(await page.evaluate(() => document.body.classList.contains('th-open')), false);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.stage-video')).position), 'relative');
  });

  await test('おまかせラジオ: ライブラリから重み付きで選曲して再生', async () => {
    await page.locator('.side-item', { hasText: 'おまかせラジオ' }).click();
    await waitFor(page, () => window.__uta.engine.state.status === 'playing' && window.__uta.state.ui.radio === true);
    const n = await page.evaluate(() => window.__uta.engine.state.context.length);
    assert.equal(n, 65);
    assert.ok(await page.locator('.toast', { hasText: 'おまかせラジオ' }).count() >= 1);
    // 普通の再生に切り替えるとラジオ表示は外れる
    await page.locator('.side-pl').first().click();
    await sleep(300);
    await page.locator('.row').first().click();
    await sleep(300);
    assert.equal(await page.evaluate(() => window.__uta.state.ui.radio), false);
  });

  await test('配信アーカイブ: 動画ごとのタイムライン、区間クリックで再生、すき間クリックで新規登録', async () => {
    await page.locator('.side-item', { hasText: '配信アーカイブ' }).click();
    await sleep(500);
    const videos = await page.evaluate(() => new Set(window.__uta.store.librarySongs().map(x => x.song.videoId)).size);
    assert.equal(await page.locator('.arc-card').count(), videos);
    assert.equal(await page.locator('.arc-seg').count(), 65);
    const card = page.locator('.arc-card').filter({ has: page.locator('.arc-seg') }).nth(1);
    await card.scrollIntoViewIfNeeded();
    const seg = card.locator('.arc-seg').first();
    const label = await seg.getAttribute('aria-label');
    await seg.click();
    await waitFor(page, (l) => l.startsWith(window.__uta.engine.state.song.title), label);
    await sleep(300);
    assert.equal(await page.locator('.arc-seg.playing').count(), 1);
    await page.screenshot({ path: `${OUT}/feature-archive.png` });
    const first = page.locator('.arc-card').first();
    await first.scrollIntoViewIfNeeded();
    const bb = await first.locator('.arc-bar').boundingBox();
    await page.mouse.click(bb.x + bb.width * 0.01, bb.y + bb.height / 2);
    await sleep(500);
    assert.ok(await page.locator('.panel-editor').isVisible());
    assert.equal(await page.locator('.panel-editor .panel-title').innerText(), '新しい曲を追加');
    assert.ok(await page.locator('.tl-ghost').count() >= 1, 'other songs from the same video shown on the timeline');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });

  await test('どこでも貼り付け: セットリストを貼ると追加画面が開き、URL と曲が入っている', async () => {
    await page.locator('.side-pl').first().click();
    await sleep(300);
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'https://www.youtube.com/watch?v=uvNqgBWckp4\n0:12 ドライフラワー / 優里\n4:30 夜に駆ける');
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForSelector('.setlist-table tbody tr');
    assert.equal(await page.locator('.setlist-table tbody tr').count(), 2);
    assert.equal(await page.locator('.add-body input.input').first().inputValue(), 'https://www.youtube.com/watch?v=uvNqgBWckp4');
    assert.equal(await page.locator('.tab.on').innerText(), 'セットリスト貼り付け');
    await page.keyboard.press('Escape');
    await sleep(200);
  });

  await test('どこでもドロップ: URL をドロップすると重ね表示が出て、URL 追加画面が開く', async () => {
    const shown = await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/uri-list', 'https://youtu.be/mHSFy9Bbpew?t=896');
      window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
      const on = document.querySelector('.drop-overlay').classList.contains('show');
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      return on;
    });
    assert.equal(shown, true);
    await page.waitForSelector('.add-modal');
    assert.equal(await page.locator('.add-body input.input').first().inputValue(), 'https://youtu.be/mHSFy9Bbpew?t=896');
    assert.equal(await page.evaluate(() => document.querySelector('.drop-overlay').classList.contains('show')), false);
    await page.keyboard.press('Escape');
  });

  await test('イントロクイズ: 5問を解いて結果・ハイスコア・間違えた曲のプレイリスト', async () => {
    // イントロクイズは現在メニューから非表示（コードは残している）
    await page.evaluate(() => import('/src/ui/quiz.js').then(m => m.openQuizSetup()));
    await page.locator('.seg-btn', { hasText: '5問' }).click();
    await page.locator('.seg-btn', { hasText: '3秒' }).click();
    await page.locator('.modal-footer .btn-primary').click();
    for (let q = 0; q < 5; q++) {
      await waitFor(page, () => document.querySelector('.quiz')?.dataset.phase === 'listening', null, 15000);
      // 回答前は答えが見えない（カードは裏返っていない）
      assert.equal(await page.locator('.q-card.flip').count(), 0);
      const title = await page.evaluate(() => window.__uta.engine.state.song.title);
      const texts = await page.locator('.q-choice b').allInnerTexts();
      assert.equal(texts.length, 4);
      const correct = texts.indexOf(title);
      assert.ok(correct >= 0, 'the answer is among the choices');
      await page.keyboard.press(String((q === 1 ? (correct + 1) % 4 : correct) + 1));
      await waitFor(page, () => document.querySelector('.quiz')?.dataset.phase === 'reveal');
      assert.equal(await page.locator('.q-card.flip').count(), 1);
      assert.equal(await page.locator('.q-choice.correct').count(), 1);
      if (q === 1) assert.equal(await page.locator('.q-choice.wrong').count(), 1);
      await page.keyboard.press('Enter');
    }
    await page.waitForSelector('.quiz.finished');
    await sleep(1400);
    assert.match(await page.locator('.q-res-stats').innerText(), /4\/5/);
    const best = await page.evaluate(() => window.__uta.state.settings.quizBest);
    assert.ok(best > 3000, `high score saved: ${best}`);
    assert.equal(await page.locator('.q-res-list li').count(), 5);
    await page.screenshot({ path: `${OUT}/feature-quiz-results.png` });
    await page.locator('.q-res-actions .btn', { hasText: '間違えた1曲' }).click();
    await sleep(500);
    assert.equal(await page.locator('.quiz').count(), 0);
    assert.match(await page.locator('.view-title').innerText(), /クイズで聴き込む曲/);
    assert.match(await page.locator('.view-meta').innerText(), /1曲/);
    // クイズの試聴は再生履歴・再生回数に残らない
    const leaked = await page.evaluate(() => window.__uta.state.history.some(h => String(h.songId).startsWith('quiz_')));
    assert.equal(leaked, false);
  });
  await ctx.close();
}

// ---------- Mobile ----------
{
  const { ctx, page } = await newPage({ width: 390, height: 844 }, { hasTouch: true });
  const swipe = (sel, dx, dy) => page.evaluate(([s, dx, dy]) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const opts = (cx, cy) => ({ pointerId: 7, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true, isPrimary: true });
    el.dispatchEvent(new PointerEvent('pointerdown', opts(x, y)));
    el.dispatchEvent(new PointerEvent('pointermove', opts(x + dx / 2, y + dy / 2)));
    el.dispatchEvent(new PointerEvent('pointerup', opts(x + dx, y + dy)));
  }, [sel, dx, dy]);

  await test('モバイル: ミニプレイヤーの左スワイプで次の曲、タップで全画面、下スワイプで閉じる', async () => {
    await page.locator('.row').first().click();
    await waitFor(page, () => window.__uta.engine.state.status === 'playing');
    const t1 = await page.evaluate(() => window.__uta.engine.state.song.title);
    await swipe('.pb-left', -120, 0);
    await waitFor(page, (t) => window.__uta.engine.state.song.title !== t, t1);
    await swipe('.pb-left', 0, 0);
    await page.waitForSelector('.theater.show');
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/feature-theater-mobile.png` });
    await swipe('.th-info', 0, 180);
    await page.waitForTimeout(700);
    assert.equal(await page.locator('.theater').count(), 0);
  });
  await ctx.close();
}

await browser.close();
await srv.close();
console.log(results.join('\n'));
if (errors.length) { console.log('\nPAGE ERRORS:'); errors.forEach(e => console.log('  ' + e)); }
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
