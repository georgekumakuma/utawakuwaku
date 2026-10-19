// 再生エンジンの E2E テスト（YouTube API をモックして実ブラウザで動かす）
// 実行: node test/engine.e2e.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, getPlaywright, ROOT } from './helpers/server.mjs';

const { chromium } = await getPlaywright();
const srv = await startServer();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/ytimg|youtube|favicon|fonts|net::ERR|Failed to load/.test(m.text())) errors.push(m.text()); });
await page.addInitScript({ content: 'window.__mock = { durations: { A: 60, B: 60, C: 104, D: 60 }, latency: 120 };' });
await page.addInitScript({ content: fs.readFileSync(path.join(ROOT, 'test/helpers/mock-yt.js'), 'utf8') });

const results = [];
let failed = 0;
async function test(name, fn) {
  try { await fn(); results.push(`ok   ${name}`); }
  catch (e) { failed++; results.push(`FAIL ${name}\n     ${e.message}`); }
}
const sleep = (ms) => page.waitForTimeout(ms);
const eng = (expr) => page.evaluate(`(() => { const e = window.__uta.engine; return (${expr}); })()`);
async function waitFor(expr, timeout = 8000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await eng(expr)) return Date.now() - t0;
    await sleep(50);
  }
  throw new Error(`timeout waiting for: ${label}`);
}
const decks = () => page.evaluate(() => window.__ytMockInstances.map(p => ({ id: p.elId, state: p.state, vol: p.vol, videoId: p.videoId, cur: Math.round(p.cur * 10) / 10 })));

await page.goto(srv.base + '/index.html');
await page.waitForFunction(() => !!window.__uta, null, { timeout: 15000 });
await sleep(300);
await page.locator('.modal-footer .btn-primary').click().catch(() => {});
await waitFor('e.ready', 5000, 'engine ready');

// テスト用プレイリスト: A 10→16 (6s), B 0→5 (5s), C 100→最後(104 = 4s)
await page.evaluate(() => {
  const { store } = window.__uta;
  store.state.settings.seenWelcome = true;
  store.createPlaylist('E2E', [
    { videoId: 'A', title: 'Song A', start: 10, end: 16, rating: 3 },
    { videoId: 'B', title: 'Song B', start: 0, end: 5, rating: 3 },
    { videoId: 'C', title: 'Song C', start: 100, end: 0, rating: 3 }
  ]);
  window.__starts = [];
  window.__uta.engine.on('songstart', ({ song }) => window.__starts.push([performance.now() | 0, song.title]));
  window.__uta.engine.setCrossfade(1.5);
  window.__uta.engine.setRepeat('all');
  window.__uta.engine.setGapless(true);
});
await sleep(200);
const ids = await page.evaluate(() => window.__uta.store.currentPlaylist().songs.map(s => s.id));

await test('クリックで再生が始まり、フェードインして音量100になる', async () => {
  await page.locator('.row').first().click();
  await waitFor("e.state.status === 'playing' && e.state.song.title === 'Song A'", 4000);
  await sleep(1000);
  const d = await decks();
  assert.equal(d[0].state, 1);
  assert.equal(d[0].videoId, 'A');
  assert.ok(d[0].vol >= 95, `volume ${d[0].vol}`);
  assert.ok(d[0].cur >= 10 && d[0].cur < 16, `cur ${d[0].cur}`);
});

await test('次の曲が裏デッキに先読みされ、頭出しで待機する', async () => {
  await waitFor('e.preloaded && e.preloaded.ready', 5000, 'preload ready');
  const d = await decks();
  assert.equal(d[1].videoId, 'B');
  assert.equal(d[1].state, 2, 'preload deck paused');
  assert.ok(Math.abs(d[1].cur - 0) < 1, `cued near start: ${d[1].cur}`);
  assert.equal(d[1].vol, 0);
});

await test('区間終了の1.5秒前からクロスフェードでBへ切り替わる（二重遷移なし）', async () => {
  await waitFor("e.state.song.title === 'Song B'", 8000);
  const startedAt = await page.evaluate(() => window.__ytMockInstances[1].cur);
  assert.ok(startedAt < 1.5, `B started from near its start: ${startedAt}`);
  // 切替直後: 旧デッキ A はまだ再生中（フェードアウト中）、新デッキ B が再生開始
  assert.equal(await eng('e.active'), 1);
  await sleep(300);
  const d1 = await decks();
  assert.equal(d1[1].state, 1, 'B deck playing');
  assert.equal(d1[0].state, 1, 'A deck still playing during crossfade');
  assert.ok(d1[0].vol < 100 && d1[1].vol > 0, `fading: A=${d1[0].vol} B=${d1[1].vol}`);
  await sleep(1800);
  const d2 = await decks();
  assert.notEqual(d2[0].state, 1, 'old deck stopped after crossfade');
  assert.ok(d2[1].vol >= 95, `B volume ${d2[1].vol}`);
  const starts = await page.evaluate(() => window.__starts.map(s => s[1]));
  assert.deepEqual(starts, ['Song A', 'Song B'], 'songstart emitted once per song');
});

await test('終了未設定の曲は動画の最後まで再生し、リピート(全曲)で先頭へ戻る', async () => {
  await waitFor("e.state.song.title === 'Song C'", 8000);
  await waitFor("e.state.song.title === 'Song A' && e.state.status === 'playing'", 9000);
  const starts = await page.evaluate(() => window.__starts.map(s => s[1]));
  assert.deepEqual(starts, ['Song A', 'Song B', 'Song C', 'Song A']);
});

await test('終了位置を越えてシークすると、その曲だけ自動終了が解除され再生が続く', async () => {
  await page.evaluate(() => window.__uta.engine.seek(30));
  await sleep(700);
  assert.equal(await eng('e.state.endDisabled'), true);
  assert.equal(await eng("e.state.song.title"), 'Song A');
  await sleep(1500);
  assert.equal(await eng("e.state.song.title"), 'Song A', 'still playing A past its end');
  const d = await decks();
  const a = d[await eng('e.active')];
  assert.equal(a.state, 1, 'playing');
  assert.ok(a.cur > 30 && a.cur < 40, `continued from the seek target: ${a.cur}`);
  assert.ok(await page.locator('.toast', { hasText: '自動終了を解除' }).count() >= 1, 'notice toast');
});

await test('プレイヤー側のシークで終了位置を飛び越えた場合も、自然な終了とは区別される', async () => {
  // 先に通常の状態へ戻す: Song B を再生
  await page.evaluate((ids) => window.__uta.actions.playSong(ids[1]), ids);
  await waitFor("e.state.song.title === 'Song B' && e.state.status === 'playing'", 5000);
  await sleep(600);
  // ユーザーが iframe のバーで 2:00 へ飛んだ（エンジンを経由しないシーク）をモックで再現
  await page.evaluate(() => { const p = window.__ytMockInstances[window.__uta.engine.active]; p.seekTo(120); });
  await sleep(900);
  assert.equal(await eng("e.state.song.title"), 'Song B', 'did not skip to next song');
  assert.equal(await eng('e.state.endDisabled'), true);
  const d = await decks();
  const a = d[await eng('e.active')];
  assert.equal(a.state, 1);
  assert.ok(a.cur >= 5, `continues past end: ${a.cur}`);
});

await test('「次に再生」キューが順序より優先される', async () => {
  await page.evaluate((ids) => {
    const { engine, store } = window.__uta;
    const c = store.findSong(ids[2]).song;
    engine.enqueue([{ song: c, playlistId: store.state.data.currentId }], { next: true });
    engine.next();
  }, ids);
  await waitFor("e.state.song.title === 'Song C' && e.state.status === 'playing'", 5000);
  assert.equal(await eng('e.state.queue.length'), 0);
  await page.evaluate(() => window.__uta.engine.next());
  await waitFor("e.state.song.title === 'Song B'", 5000, 'order resumes after queue (pos was A → B)');
});

await test('クロスフェード中に別の曲を選んでも、旧デッキが鳴り続けない', async () => {
  await page.evaluate((ids) => { window.__uta.actions.playSong(ids[0]); }, ids);
  await waitFor("e.state.song.title === 'Song A' && e.state.status === 'playing'", 5000);
  await waitFor('e.preloaded && e.preloaded.ready', 6000);
  await waitFor("e.state.song.title === 'Song B'", 8000);   // クロスフェード開始
  await sleep(300);
  await page.evaluate((ids) => { window.__uta.actions.playSong(ids[2]); }, ids); // 途中で C を選ぶ
  await waitFor("e.state.song.title === 'Song C' && e.state.status === 'playing'", 5000);
  await sleep(1500);
  const d = await decks();
  const playing = d.filter(x => x.state === 1);
  assert.equal(playing.length, 1, `exactly one deck playing: ${JSON.stringify(d)}`);
  assert.equal(playing[0].videoId, 'C');
});

await test('リピートOFFで最後の曲が終わると停止する', async () => {
  await page.evaluate(() => { window.__uta.engine.setRepeat('off'); window.__uta.engine.setGapless(false); });
  await waitFor("e.state.status === 'idle'", 9000, 'finish');
  assert.equal(await eng("e.state.song.title"), 'Song C');
});

await test('再生できない動画はエラー通知のうえ自動スキップ', async () => {
  await page.evaluate(() => {
    const { store, engine } = window.__uta;
    engine.setRepeat('all');
    store.createPlaylist('ERR', [
      { videoId: 'ERRX1', title: 'Broken', start: 0, end: 5 },
      { videoId: 'D', title: 'Song D', start: 0, end: 5 }
    ]);
    window.__errors = [];
    engine.on('error', (e) => window.__errors.push(e.message));
  });
  await sleep(200);
  await page.locator('.row').first().click();
  await waitFor("e.state.song.title === 'Song D' && e.state.status === 'playing'", 6000);
  const errs = await page.evaluate(() => window.__errors);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /見つかりません/);
  assert.ok(await page.locator('.toast-error').count() >= 1, 'error toast shown');
});

await test('試聴（プレビュー）は指定範囲で止まり、自動遷移しない', async () => {
  await page.evaluate(() => {
    const e = window.__uta.engine;
    e.preview({ videoId: 'A', title: 'draft', start: 10, end: 16, _draft: true }, 14, 16);
  });
  await waitFor("e.state.status === 'preview'", 3000);
  await waitFor("e.state.status === 'paused'", 5000, 'preview end pause');
  const d = await decks();
  const active = await eng('e.active');
  assert.ok(Math.abs(d[active].cur - 16) < 0.5, `paused at end: ${d[active].cur}`);
  await sleep(600);
  assert.equal(await eng("e.state.status"), 'paused');
});

await test('再生速度・音量・ミュートがデッキへ反映される', async () => {
  await page.evaluate(() => { const a = window.__uta.actions; a.setRate(1.5); a.setVolume(40); });
  await sleep(100);
  let d = await decks();
  const active = await eng('e.active');
  assert.equal(await page.evaluate(() => window.__ytMockInstances.map(p => p.rate)[window.__uta.engine.active]), 1.5);
  assert.equal(d[active].vol, 40);
  await page.evaluate(() => window.__uta.actions.toggleMute());
  await sleep(100);
  d = await decks();
  assert.equal(d[active].vol, 0);
  await page.evaluate(() => { window.__uta.actions.toggleMute(); window.__uta.actions.setRate(1); });
});

await test('曲ごとの音量補正がマスター音量に掛け合わされる', async () => {
  await page.evaluate(() => { window.__uta.actions.setVolume(60); window.__uta.engine.setRepeat('all'); window.__uta.engine.setGapless(true); });
  await page.evaluate((ids) => { window.__uta.store.updateSong(ids[0], { gain: -50 }); window.__uta.actions.playSong(ids[0]); }, ids);
  await waitFor("e.state.song.title === 'Song A' && e.state.status === 'playing'", 5000);
  await sleep(1000);
  const d = await decks();
  assert.equal(d[await eng('e.active')].vol, 30, '60% × (1 - 50%)');
  await page.evaluate((ids) => window.__uta.store.updateSong(ids[0], { gain: 0 }), ids);
  await page.evaluate(() => window.__uta.actions.setVolume(100));
});

await test('スリープタイマー「この曲の終わりで停止」は先読みせず、区間の終わりで止まる', async () => {
  await page.evaluate((ids) => window.__uta.actions.playSong(ids[1]), ids);
  await waitFor("e.state.song.title === 'Song B' && e.state.status === 'playing'", 5000);
  await page.evaluate(() => window.__uta.actions.setSleepTimer('song'));
  await waitFor("e.state.status === 'idle'", 8000, 'stopped');
  assert.equal(await eng('e.state.song.title'), 'Song B');
  assert.equal(await eng('e.preloaded'), null);
  assert.equal(await eng('e.stopAfterCurrent'), false);
  assert.equal(await page.evaluate(() => window.__uta.state.ui.sleep), null);
  assert.ok(await page.locator('.toast', { hasText: 'スリープタイマー' }).count() >= 1);
});

await test('再生エラーになった動画にリンク切れの印が付く', async () => {
  const broken = await page.evaluate(() => {
    const pl = window.__uta.store.playlists().find(p => p.name === 'ERR');
    return pl.songs.map(s => s.broken);
  });
  assert.deepEqual(broken, ['missing', '']);
});

await browser.close();
await srv.close();
console.log(results.join('\n'));
if (errors.length) { console.log('\nPAGE ERRORS:'); errors.forEach(e => console.log('  ' + e)); }
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
