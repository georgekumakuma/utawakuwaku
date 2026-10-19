// CSV の読み書き
// 旧バージョンの "videoId,title,start,end,rating,article" と完全互換。
// 拡張列（artist, singer, tags, note）は、データがあるときだけ末尾に追加する。
// 旧版は先頭6列しか見ないので、拡張CSVも旧版でそのまま読める。

import { parseTime, secToCSV } from './time.js';
import { normalizeSong } from './model.js';

export const CSV_BASE_COLUMNS = ['videoId', 'title', 'start', 'end', 'rating', 'article'];
export const CSV_EXT_COLUMNS = ['artist', 'singer', 'tags', 'note'];
export const CSV_HEADER = CSV_BASE_COLUMNS.join(',');

// RFC4180 風の汎用パーサ（引用符内の改行・カンマ・"" エスケープに対応）
export function parseCSVRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
      continue;
    }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

function headerIndex(header) {
  const idx = {};
  header.forEach((h, i) => {
    const key = h.trim().toLowerCase().replace(/[\s_-]/g, '');
    if (key && !(key in idx)) idx[key] = i;
  });
  return idx;
}

// CSV → 曲配列。ヘッダー名で列を特定する（列順の違いにも強い）。
// ヘッダーが無い場合は旧形式の列順とみなす。
export function csvToSongs(text) {
  const rows = parseCSVRows(text);
  if (!rows.length) return [];
  let header = rows[0];
  let body = rows.slice(1);
  let idx = headerIndex(header);
  if (!('videoid' in idx)) {
    // ヘッダー無し: 旧形式の列順を仮定
    idx = { videoid: 0, title: 1, start: 2, end: 3, rating: 4, article: 5 };
    body = rows;
  }
  const col = (r, key) => (idx[key] != null ? (r[idx[key]] ?? '') : '').trim();
  const out = [];
  for (const r of body) {
    const videoId = col(r, 'videoid');
    if (!videoId) continue;
    const song = normalizeSong({
      videoId,
      title: col(r, 'title'),
      start: parseTime(col(r, 'start')),
      end: parseTime(col(r, 'end')),
      rating: col(r, 'rating'),
      article: col(r, 'article'),
      artist: col(r, 'artist'),
      singer: col(r, 'singer'),
      tags: col(r, 'tags'),
      note: col(r, 'note')
    });
    if (song) out.push(song);
  }
  return out;
}

function esc(val) {
  const s = val == null ? '' : String(val);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// 曲配列 → CSV。拡張列は使われているときだけ出力
export function songsToCSV(songs, { extended = 'auto' } = {}) {
  const useExt = extended === true || (extended === 'auto' && songs.some(s =>
    (s.artist && s.artist.trim()) || (s.singer && s.singer.trim()) ||
    (s.tags && s.tags.length) || (s.note && s.note.trim())));
  const cols = useExt ? [...CSV_BASE_COLUMNS, ...CSV_EXT_COLUMNS] : CSV_BASE_COLUMNS;
  const lines = [cols.join(',')];
  for (const s of songs) {
    const line = [
      esc(s.videoId), esc(s.title), secToCSV(s.start), secToCSV(s.end),
      String(s.rating ?? 1), esc(s.article || '')
    ];
    if (useExt) {
      line.push(esc(s.artist || ''), esc(s.singer || ''), esc((s.tags || []).join(' ')), esc(s.note || ''));
    }
    lines.push(line.join(','));
  }
  return lines.join('\n');
}
