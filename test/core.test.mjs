import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseTime, formatTime, secToCSV } from '../src/core/time.js';
import { parseYouTubeInput, extractVideoId } from '../src/core/ytid.js';
import { csvToSongs, songsToCSV, parseCSVRows } from '../src/core/csv.js';
import { parseSetlist, splitTitleArtist, songsToSetlist } from '../src/core/setlist.js';
import { encodeShare, decodeShare } from '../src/core/share.js';
import { normalizeSong, migrateV2, uniqueName, sanitizeData } from '../src/core/model.js';

test('parseTime: 各種形式', () => {
  assert.equal(parseTime('1:23:45'), 5025);
  assert.equal(parseTime('3:05'), 185);
  assert.equal(parseTime('90'), 90);
  assert.equal(parseTime('90.5'), 90.5);
  assert.equal(parseTime('1:02.5'), 62.5);
  assert.equal(parseTime('1h2m3s'), 3723);
  assert.equal(parseTime('2m'), 120);
  assert.ok(Number.isNaN(parseTime('abc')));
  assert.ok(Number.isNaN(parseTime('')));
});

test('formatTime / secToCSV', () => {
  assert.equal(formatTime(5025), '1:23:45');
  assert.equal(formatTime(185), '3:05');
  assert.equal(formatTime(62.5, { frac: true }), '1:02.5');
  assert.equal(secToCSV(90), '90');
  assert.equal(secToCSV(90.5), '90.5');
  assert.equal(secToCSV(90.04), '90');
});

test('YouTube URL/ID 解析', () => {
  assert.deepEqual(parseYouTubeInput('https://www.youtube.com/watch?v=uvNqgBWckp4&t=861s'), { videoId: 'uvNqgBWckp4', start: 861 });
  assert.deepEqual(parseYouTubeInput('https://youtu.be/uvNqgBWckp4?t=1h2m3s'), { videoId: 'uvNqgBWckp4', start: 3723 });
  assert.equal(extractVideoId('https://www.youtube.com/shorts/8se2-Tb8mrI'), '8se2-Tb8mrI');
  assert.equal(extractVideoId('https://www.youtube.com/live/uvNqgBWckp4?si=abc'), 'uvNqgBWckp4');
  assert.equal(extractVideoId('uvNqgBWckp4'), 'uvNqgBWckp4');
  assert.equal(extractVideoId('https://www.youtube.com/watch?feature=share&v=uvNqgBWckp4'), 'uvNqgBWckp4');
  assert.equal(extractVideoId('not a url'), null);
});

test('CSV: 旧形式の往復', () => {
  const csv = 'videoId,title,start,end,rating,article\nuvNqgBWckp4,三年目の浮気,861,1096,5,【歌枠】テスト\nabc,"カンマ,入り",0:00,0:00,9,"引用""符"';
  const songs = csvToSongs(csv);
  assert.equal(songs.length, 2);
  assert.equal(songs[0].title, '三年目の浮気');
  assert.equal(songs[0].start, 861);
  assert.equal(songs[0].end, 1096);
  assert.equal(songs[0].rating, 5);
  assert.equal(songs[1].title, 'カンマ,入り');
  assert.equal(songs[1].article, '引用"符');
  assert.equal(songs[1].rating, 6, '評価は上限6に丸められる');
  const out = songsToCSV(songs);
  assert.equal(out.split('\n')[0], 'videoId,title,start,end,rating,article', '拡張データが無ければ旧ヘッダー');
  assert.equal(csvToSongs(out).length, 2);
  assert.equal(csvToSongs(out)[1].title, 'カンマ,入り');
});

test('CSV: 余分な列・列順違い・ヘッダー無し・BOM・引用符内改行', () => {
  const extra = 'videoId,title,start,end,rating,article,\nabc12345678,曲,10,20,3,記事,4392';
  assert.equal(csvToSongs(extra)[0].article, '記事');
  const reordered = 'title,videoId,end,start\n曲,abc12345678,20,10';
  const s = csvToSongs(reordered)[0];
  assert.equal(s.videoId, 'abc12345678');
  assert.equal(s.start, 10);
  assert.equal(s.end, 20);
  const noHeader = 'abc12345678,曲,10,20,3,記事';
  assert.equal(csvToSongs(noHeader)[0].title, '曲');
  const bom = '﻿videoId,title,start,end,rating,article\nabc12345678,"複数\n行",1,2,1,x';
  assert.equal(csvToSongs(bom)[0].title, '複数\n行');
  assert.equal(parseCSVRows('a,b\r\nc,d').length, 2);
});

test('CSV: 拡張列はデータがあるときだけ出力', () => {
  const songs = [normalizeSong({ videoId: 'abc12345678', title: 'T', start: 1, end: 2, artist: 'A', tags: ['x', 'y'] })];
  const out = songsToCSV(songs);
  assert.ok(out.startsWith('videoId,title,start,end,rating,article,artist,singer,tags,note'));
  const back = csvToSongs(out)[0];
  assert.equal(back.artist, 'A');
  assert.deepEqual(back.tags, ['x', 'y']);
});

test('セットリスト解析: 基本', () => {
  const text = `セトリ
1. 0:12 ドライフラワー / 優里
2. 4:30 夜に駆ける - YOASOBI
・9:01 ～ 12:40 「残酷な天使のテーゼ」
1:00:05 アンコール (cover)`;
  const items = parseSetlist(text, { duration: 3700 });
  assert.equal(items.length, 4);
  assert.deepEqual(items[0], { title: 'ドライフラワー', artist: '優里', start: 12, end: 270, raw: '1. 0:12 ドライフラワー / 優里' });
  assert.equal(items[1].title, '夜に駆ける');
  assert.equal(items[1].artist, 'YOASOBI');
  assert.equal(items[1].end, 541);
  assert.equal(items[2].title, '残酷な天使のテーゼ');
  assert.equal(items[2].start, 541);
  assert.equal(items[2].end, 760, '明示された終了時刻');
  assert.equal(items[3].start, 3605);
  assert.equal(items[3].end, 3700, '最後は動画の長さ');
  assert.equal(items[3].title, 'アンコール (cover)');
});

test('セットリスト解析: 時刻が後ろ・長さ不明・gap', () => {
  const items = parseSetlist('曲A (1:00)\n曲B 2:00\n', { gap: 2 });
  assert.equal(items[0].title, '曲A');
  assert.equal(items[0].end, 118);
  assert.equal(items[1].end, 0, '長さ不明なら最後まで');
  assert.equal(parseSetlist('タイムスタンプなし').length, 0);
});

test('splitTitleArtist', () => {
  assert.deepEqual(splitTitleArtist('A / B'), { title: 'A', artist: 'B' });
  assert.deepEqual(splitTitleArtist('A／B'), { title: 'A', artist: 'B' });
  assert.deepEqual(splitTitleArtist('A/B'), { title: 'A', artist: 'B' });
  assert.deepEqual(splitTitleArtist('A'), { title: 'A', artist: '' });
  assert.deepEqual(splitTitleArtist('A by B'), { title: 'A', artist: 'B' });
});

test('songsToSetlist', () => {
  const songs = [normalizeSong({ videoId: 'abc12345678', title: 'T', artist: 'A', start: 65, end: 120 })];
  assert.equal(songsToSetlist(songs), '1:05 T / A');
  assert.equal(songsToSetlist(songs, { withEnd: true }), '1:05 - 2:00 T / A');
});

test('共有URL: 往復と旧形式', async () => {
  const songs = [
    normalizeSong({ videoId: 'uvNqgBWckp4', title: '三年目の浮気', start: 861, end: 1096, rating: 5, article: '歌枠' }),
    normalizeSong({ videoId: 'mHSFy9Bbpew', title: 'おちゃめ機能', start: 896, end: 1029, rating: 5, artist: 'ゴジマジP', tags: ['ボカロ'] })
  ];
  const hash = await encodeShare({ name: 'テスト', songs });
  assert.ok(hash.startsWith('#pl2='));
  const back = await decodeShare(hash);
  assert.equal(back.name, 'テスト');
  assert.equal(back.songs.length, 2);
  assert.equal(back.songs[1].artist, 'ゴジマジP');
  assert.deepEqual(back.songs[1].tags, ['ボカロ']);
  // 旧形式 (#pl=base64url(CSV))
  const csv = 'videoId,title,start,end,rating,article\nuvNqgBWckp4,旧,1,2,3,x';
  const legacy = '#pl=' + Buffer.from(csv, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const old = await decodeShare(legacy);
  assert.equal(old.songs[0].title, '旧');
  assert.equal(await decodeShare('#foo'), null);
});

test('モデル: 移行とユーティリティ', () => {
  const v2 = { current: 'B', lists: { A: [{ videoId: 'abc12345678', title: 'a', start: 0, end: 10, rating: 2, article: '' }], B: [] } };
  const data = migrateV2(v2);
  assert.equal(data.playlists.length, 2);
  assert.equal(data.playlists.find(p => p.id === data.currentId).name, 'B');
  assert.equal(uniqueName('X', ['X', 'X 2']), 'X 3');
  const s = normalizeSong({ videoId: 'abc12345678', rating: '99', start: '5.55', end: '-3', tags: 'a, b #c' });
  assert.equal(s.rating, 6);
  assert.equal(s.start, 5.6);
  assert.equal(s.end, 0);
  assert.deepEqual(s.tags, ['a', 'b', 'c']);
  const san = sanitizeData({ playlists: [{ id: 'p1', name: 'n', songs: [] }, { id: 'p1', name: 'dup', songs: [] }], currentId: 'nope' });
  assert.notEqual(san.playlists[0].id, san.playlists[1].id);
  assert.equal(san.currentId, 'p1');
});

import { normalizeTitle, groupVersions, suggestTags, computeStats } from '../src/core/insights.js';

test('同じ曲の判定（曲名の正規化）', () => {
  assert.equal(normalizeTitle('夜に駆ける'), normalizeTitle('夜に駆ける (cover)'));
  assert.equal(normalizeTitle('ＹＯＡＳＯＢＩ'), normalizeTitle('yoasobi'));
  assert.equal(normalizeTitle('残酷な天使のテーゼ'), normalizeTitle('残酷な 天使の テーゼ【歌ってみた】'));
  assert.notEqual(normalizeTitle('ドライフラワー'), normalizeTitle('夜に駆ける'));
  assert.equal(normalizeTitle('【LIVE】'), 'live', '全体が括弧なら中身を残す');
  const items = ['夜に駆ける', '夜に駆ける（short）', 'ドライフラワー'].map(t => ({ song: normalizeSong({ videoId: 'abc12345678', title: t }) }));
  const g = groupVersions(items);
  assert.equal(g.size, 1);
  assert.equal([...g.values()][0].length, 2);
});

test('タグ候補', () => {
  const s = normalizeSong({ videoId: 'abc12345678', title: 'T', article: '【歌枠】クリスマス前に！【ボカロ/アニソン】 #水城あくあ #shorts' });
  assert.deepEqual(suggestTags(s), ['歌枠', 'ボカロ', 'アニソン', '水城あくあ']);
  assert.deepEqual(suggestTags(s, ['ボカロ']), ['歌枠', 'アニソン', '水城あくあ']);
});

test('統計', () => {
  const now = new Date(2026, 9, 19, 12).getTime();
  const pls = [
    { songs: [normalizeSong({ videoId: 'a0000000000', title: 'A', start: 0, end: 60, playCount: 3, singer: 'X', artist: 'P' }),
              normalizeSong({ videoId: 'a0000000000', title: 'B', start: 60, end: 90, playCount: 0, singer: 'X' })] },
    { songs: [normalizeSong({ videoId: 'a0000000000', title: 'A', start: 0, end: 60, playCount: 3 })] }
  ];
  const hist = [{ at: now - 3600000, start: 0, end: 60 }, { at: now - 86400000 * 2, start: 0, end: 30 }];
  const st = computeStats(pls, hist, { now });
  assert.equal(st.songCount, 2, '重複は1曲として数える');
  assert.equal(st.totalLength, 90);
  assert.equal(st.totalPlays, 3);
  assert.equal(st.listened, 90);
  assert.equal(st.topSongs[0].title, 'A');
  assert.equal(st.topSingers[0].name, 'X');
  assert.equal(st.topSingers[0].count, 2);
  assert.equal(st.neverPlayed, 1);
  assert.equal(st.daily[29], 1, '今日');
  assert.equal(st.daily[27], 1, '2日前');
});

import { normalizeBankUrl, parseBankText, songsToTSV } from '../src/core/sharedbank.js';

test('共有バンク: URL の正規化', () => {
  assert.deepEqual(normalizeBankUrl('https://docs.google.com/spreadsheets/d/e/2PACX-abc_DEF/pubhtml?gid=123&single=true'),
    { url: 'https://docs.google.com/spreadsheets/d/e/2PACX-abc_DEF/pub?output=csv&gid=123&single=true', kind: 'gsheet-pub' });
  assert.equal(normalizeBankUrl('https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?output=csv').url,
    'https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?output=csv');
  assert.deepEqual(normalizeBankUrl('https://docs.google.com/spreadsheets/d/1AbC-xyz/edit#gid=456'),
    { url: 'https://docs.google.com/spreadsheets/d/1AbC-xyz/export?format=csv&gid=456', kind: 'gsheet-export' });
  assert.equal(normalizeBankUrl('https://drive.google.com/file/d/FILEID/view?usp=sharing').kind, 'gdrive');
  assert.equal(normalizeBankUrl('https://github.com/georgekumakuma/utawakuwaku/blob/main/playlists/samples/playlistbank.json').url,
    'https://raw.githubusercontent.com/georgekumakuma/utawakuwaku/main/playlists/samples/playlistbank.json');
  assert.equal(normalizeBankUrl('ただの文字'), null);
  assert.equal(normalizeBankUrl('javascript:alert(1)'), null);
});

test('共有バンク: 中身の解釈', () => {
  const bank = parseBankText(JSON.stringify({ name: 'みんなの歌枠', presets: [{ id: 'a', name: 'A', file: 'a.csv' }, { name: 'B', url: 'https://github.com/u/r/blob/main/b.csv' }] }),
    'https://raw.githubusercontent.com/u/r/main/playlistbank.json');
  assert.equal(bank.kind, 'bank');
  assert.equal(bank.name, 'みんなの歌枠');
  assert.equal(bank.presets[0].url, 'https://raw.githubusercontent.com/u/r/main/a.csv');
  assert.equal(bank.presets[1].url, 'https://raw.githubusercontent.com/u/r/main/b.csv');
  const csv = parseBankText('videoId,title,start,end\nuvNqgBWckp4,曲,1:00,2:00', 'https://x');
  assert.equal(csv.kind, 'csv');
  assert.equal(csv.songs[0].start, 60);
  assert.throws(() => parseBankText('<!DOCTYPE html><html>', 'https://x'), /ウェブに公開/);
  assert.throws(() => parseBankText('a,b\n1,2', 'https://x'), /曲が見つかりません/);
});

test('スプレッドシート貼り付け用 TSV', () => {
  const tsv = songsToTSV([normalizeSong({ videoId: 'abc12345678', title: 'タブ\tを含む', start: 1, end: 2, tags: ['a', 'b'] })]);
  const lines = tsv.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[1].split('\t').length, 10);
  assert.equal(lines[1].split('\t')[1], 'タブ を含む');
  assert.equal(csvToSongs(tsv.replace(/\t/g, ',')).length, 1);
});

import { pickPalette, accentFromColor, contrast, fromHex, rgbToHsl, hslToRgb, toHex } from '../src/core/color.js';

function img(fills) {
  // fills: [[r,g,b,count], ...] → RGBA 配列
  const px = [];
  for (const [r, g, b, n] of fills) for (let i = 0; i < n; i++) px.push(r, g, b, 255);
  return new Uint8ClampedArray(px);
}

test('色: HSL 変換の往復', () => {
  for (const hex of ['#ff0000', '#2f80ed', '#7c5cff', '#3ddc84', '#808080']) {
    assert.equal(toHex(hslToRgb(...rgbToHsl(...fromHex(hex)))), hex);
  }
});

test('色: サムネイルから代表色を選ぶ', () => {
  const p = pickPalette(img([[220, 30, 40, 400], [30, 60, 220, 300], [128, 128, 128, 2000], [10, 10, 10, 1000]]));
  assert.equal(p.length, 3);
  const hues = p.map(x => Math.round(rgbToHsl(...fromHex(x))[0]));
  assert.ok(hues[0] < 10 || hues[0] > 350, `主色は赤: ${hues}`);
  assert.ok(Math.abs(hues[1] - 228) < 10, `2色目は青: ${hues}`);
  assert.equal(pickPalette(img([[128, 128, 128, 500], [20, 20, 20, 500]])), null, 'モノクロは null');
});

test('色: アクセントは背景に対して読める明るさに調整される', () => {
  for (const hex of ['#ffe600', '#0a1a6b', '#3ddc84', '#ff5c8a', '#4b0082']) {
    const d = accentFromColor(hex, 'dark');
    assert.ok(contrast(fromHex(d.accent), [14, 15, 20]) >= 4.5, `dark ${hex} → ${d.accent}`);
    const l = accentFromColor(hex, 'light');
    assert.ok(contrast(fromHex(l.accent), [244, 245, 249]) >= 4.5, `light ${hex} → ${l.accent}`);
  }
});

import { radioPick, seededRandom } from '../src/core/insights.js';

test('おまかせラジオ: 重み付き抽選', () => {
  const now = Date.UTC(2026, 10, 5);
  const mk = (id, vid, rating, extra = {}) => ({ song: normalizeSong({ id, videoId: vid, title: id, rating, ...extra }) });
  const items = [
    mk('hi', 'v0000000001', 6), mk('lo', 'v0000000002', 1),
    mk('recent', 'v0000000003', 6, { lastPlayedAt: now - 60000, playCount: 3 }),
    mk('broken', 'v0000000004', 6, { broken: 'missing' }),
    mk('hi2', 'v0000000001', 6)
  ];
  const all = radioPick(items, 10, { now, rand: seededRandom('x') });
  assert.equal(all.length, 4, 'リンク切れは除外、重複なし');
  assert.ok(!all.some(it => it.song.id === 'broken'));
  // 高評価・未再生の曲が、低評価や直前に聴いた曲より選ばれやすい
  const counts = { hi: 0, lo: 0, recent: 0 };
  for (let i = 0; i < 400; i++) {
    const [first] = radioPick(items.slice(0, 3), 1, { now, rand: seededRandom('s' + i) });
    counts[first.song.id]++;
  }
  assert.ok(counts.hi > counts.recent * 3, JSON.stringify(counts));
  assert.ok(counts.hi > counts.lo * 5, JSON.stringify(counts));
  // 同じ動画が連続しない
  for (let i = 0; i < 50; i++) {
    const seq = radioPick(items, 4, { now, rand: seededRandom('c' + i) });
    for (let j = 1; j < seq.length; j++) {
      if (seq[j].song.videoId === seq[j - 1].song.videoId) {
        const others = seq.slice(j).some(x => x.song.videoId !== seq[j - 1].song.videoId);
        assert.ok(!others, '避けられる連続は避ける');
      }
    }
  }
});

import { buildQuiz, quizPool, scoreAnswer, quizStart, grade } from '../src/core/quiz.js';

test('イントロクイズ: 出題', () => {
  const mk = (t, extra = {}) => ({ song: normalizeSong({ videoId: 'abc12345678', title: t, start: 0, end: 60, ...extra }) });
  const items = ['夜に駆ける', '夜に駆ける (cover)', 'ドライフラワー', '残酷な天使のテーゼ', '千本桜', 'マリーゴールド'].map(t => mk(t));
  items.push(mk('壊れた', { broken: 'missing' }));
  assert.equal(quizPool(items).length, 5, '同じ曲名・リンク切れは除外');
  const q = buildQuiz(items, { count: 10, rand: seededRandom('q') });
  assert.equal(q.length, 5, '曲数より多くは出題しない');
  for (const x of q) {
    assert.equal(x.choices.length, 4);
    assert.ok(x.choices.includes(x.answer));
    assert.equal(new Set(x.choices.map(c => c.song.title)).size, 4, '選択肢は重複しない');
  }
  assert.equal(new Set(q.map(x => x.answer.song.title)).size, 5, '同じ曲は2回出ない');
  assert.throws(() => buildQuiz(items.slice(0, 3)), /4曲以上/);
});

test('イントロクイズ: 採点と開始位置', () => {
  assert.deepEqual(scoreAnswer({ correct: false, elapsedMs: 100, limitMs: 10000, streak: 3 }), { points: 0, streak: 0 });
  const fast = scoreAnswer({ correct: true, elapsedMs: 0, limitMs: 10000, streak: 0 });
  const slow = scoreAnswer({ correct: true, elapsedMs: 9000, limitMs: 10000, streak: 0 });
  assert.equal(fast.points, 1000);
  assert.ok(slow.points < fast.points && slow.points >= 400);
  assert.equal(scoreAnswer({ correct: true, elapsedMs: 0, limitMs: 10000, streak: 9 }).points, 1500, 'ボーナスは最大+50%');
  const s = normalizeSong({ videoId: 'abc12345678', title: 'x', start: 100, end: 200 });
  assert.equal(quizStart(s, 'start', 5), 100);
  for (let i = 0; i < 30; i++) {
    const at = quizStart(s, 'random', 5, seededRandom('r' + i));
    assert.ok(at >= 101 && at <= 200 - 5 - 1, `${at}`);
  }
  assert.equal(quizStart(normalizeSong({ videoId: 'abc12345678', title: 'x', start: 10, end: 0 }), 'random', 5), 10, '終了未設定は頭から');
  assert.equal(grade(1).label, 'PERFECT');
  assert.equal(grade(0.1).label, 'C');
});

import { classifyText, tsvToCsv } from '../src/core/intake.js';

test('貼り付けの判定', () => {
  assert.equal(classifyText(''), null);
  assert.equal(classifyText('こんにちは'), null);
  assert.deepEqual(classifyText('https://youtu.be/uvNqgBWckp4?t=90'), { kind: 'url', url: 'https://youtu.be/uvNqgBWckp4?t=90' });
  const setlist = classifyText('https://www.youtube.com/watch?v=uvNqgBWckp4\nセトリ\n0:12 曲A\n4:30 曲B / 歌手');
  assert.equal(setlist.kind, 'setlist');
  assert.equal(setlist.url, 'https://www.youtube.com/watch?v=uvNqgBWckp4');
  assert.equal(classifyText('0:12 曲A\n4:30 曲B').url, '', 'URL なしのセットリスト');
  assert.equal(classifyText('videoId,title,start,end\nuvNqgBWckp4,曲,1,2').kind, 'csv');
  const tsv = classifyText('videoId\ttitle\tstart\tend\nuvNqgBWckp4\t曲, カンマ\t1\t2');
  assert.equal(tsv.kind, 'csv');
  assert.equal(csvToSongs(tsv.text)[0].title, '曲, カンマ', 'TSV は CSV に変換');
  assert.equal(classifyText('https://docs.google.com/spreadsheets/d/e/2PACX-x/pubhtml').kind, 'bank');
  assert.equal(classifyText('https://example.com/list.csv').kind, 'bank');
  assert.equal(classifyText('https://example.com/page'), null);
  assert.equal(classifyText('見て！ https://www.youtube.com/watch?v=uvNqgBWckp4 最高').kind, 'url', '文中の URL');
  assert.equal(tsvToCsv('a\tb"c'), 'a,"b""c"');
});

import { pickTrack, estimateEnd, searchTerm, cacheKey } from '../src/core/tracklen.js';

test('原曲の長さ: 検索結果から合う曲を選ぶ', () => {
  const res = [
    { kind: 'song', trackName: '夜に駆ける (TV Size)', artistName: 'YOASOBI', trackTimeMillis: 89000 },
    { kind: 'song', trackName: '夜に駆ける', artistName: '別の歌手', trackTimeMillis: 250000 },
    { kind: 'song', trackName: '夜に駆ける', artistName: 'YOASOBI', trackTimeMillis: 261000 },
    { kind: 'song', trackName: '夜に駆ける (Instrumental)', artistName: 'YOASOBI', trackTimeMillis: 261500 },
    { kind: 'music-video', trackName: '夜に駆ける', artistName: 'YOASOBI', trackTimeMillis: 270000 }
  ];
  const p = pickTrack(res, { title: '夜に駆ける', artist: 'YOASOBI' });
  assert.equal(p.seconds, 261);
  assert.equal(p.artistName, 'YOASOBI');
  assert.equal(pickTrack(res, { title: '夜に駆ける' }).seconds, 250, 'アーティスト不明なら原題一致の先頭（TVサイズ・インストは除外）');
  assert.equal(pickTrack(res, { title: '夜に駆ける (TV Size)', artist: 'YOASOBI' }).seconds, 89, '曲名にTVサイズとあれば選べる');
  assert.equal(pickTrack(res, { title: 'まったく別の曲' }), null);
  assert.equal(pickTrack([], { title: 'x' }), null);
});

test('原曲の長さ: 終わりの推定は短くする方向だけ', () => {
  // 開始 100、次の曲が 400 から。原曲 240 秒 + 余韻 5 → 345 で終了（55秒カット）
  assert.deepEqual(estimateEnd({ start: 100, end: 400, duration: 240, tail: 5 }), { end: 345, cut: 55 });
  // 曲間がほぼない → 変更なし
  assert.equal(estimateEnd({ start: 100, end: 346, duration: 240, tail: 5 }), null);
  // 区間が原曲より明らかに短い（TVサイズで歌った等）→ 変更なし
  assert.equal(estimateEnd({ start: 100, end: 220, duration: 240 }), null);
  // 終わり不明（最後の曲）→ 推定値を入れる
  assert.deepEqual(estimateEnd({ start: 100, end: 0, duration: 240, tail: 3 }), { end: 343, cut: null });
  // 短すぎる「原曲」（効果音など）は使わない
  assert.equal(estimateEnd({ start: 0, end: 300, duration: 20 }), null);
});

test('原曲の長さ: 検索語とキャッシュキー', () => {
  assert.equal(searchTerm({ title: '夜に駆ける (cover)', artist: 'YOASOBI' }), '夜に駆ける YOASOBI');
  assert.equal(searchTerm({ title: '【歌ってみた】' }), '【歌ってみた】');
  assert.equal(cacheKey({ title: '夜に駆ける（cover）', artist: 'Ｙｏａｓｏｂｉ' }), cacheKey({ title: '夜に駆ける', artist: 'yoasobi' }));
});
