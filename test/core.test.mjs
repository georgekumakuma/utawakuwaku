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
