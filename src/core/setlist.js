// セットリスト（タイムスタンプ付きテキスト）の解析
//
// YouTube の概要欄やコメント欄に書かれる
//   1:23:45 曲名 / アーティスト
//   01:02 曲名
//   1:23:45 ～ 1:27:00 曲名
//   ・曲名 (1:23:45)
// のような行から { title, artist, start, end } の配列を作る。
// 終了時刻が書かれていない行は「次の行の開始時刻」を終了時刻にする。

import { parseTime, formatTime } from './time.js';

const TS_RE = /(?<![\d:])(\d{1,2}:)?(\d{1,3}):(\d{2})(?![\d:])/g;
const RANGE_SEP_RE = /^\s*[-~〜～–—→>]+\s*$/;

function cleanTitle(s) {
  let t = String(s || '')
    .replace(/[​ ]/g, ' ')
    // タイムスタンプを取り除いた残骸（先頭の閉じ括弧・末尾の開き括弧など）だけを削る
    .replace(/^[\s\-–—・•*＊※>＞|｜:：,，\])）」』]+/, '')
    .replace(/[\s\-–—・•*＊|｜:：,，\[(（「『]+$/, '')
    .replace(/^\d{1,3}[\.．)）:：]\s*/, '')      // "1. " "1) " などの番号
    .replace(/^(?:♪|🎵|🎶|🎤|▶|■|□|◆|◇|●|○)\s*/, '')
    .trim();
  // 全体が「」『』で囲まれていれば外す
  const m = t.match(/^[「『](.+)[」』]$/);
  if (m) t = m[1].trim();
  return t;
}

// "曲名 / アーティスト" → { title, artist }
export function splitTitleArtist(text) {
  const t = String(text || '').trim();
  const seps = [' / ', ' ／ ', '／', ' - ', ' – ', ' — ', ' by ', ' BY ', '｜', ' | '];
  for (const sep of seps) {
    const i = t.indexOf(sep);
    if (i > 0 && i < t.length - sep.length) {
      const a = t.slice(0, i).trim();
      const b = t.slice(i + sep.length).trim();
      if (a && b) return { title: a, artist: b };
    }
  }
  // スペース無しのスラッシュ（"ドライフラワー/優里"）: URL っぽくなければ分割
  const i = t.indexOf('/');
  if (i > 0 && i < t.length - 1 && !/https?:/.test(t)) {
    const a = t.slice(0, i).trim();
    const b = t.slice(i + 1).trim();
    if (a && b && !b.includes('/')) return { title: a, artist: b };
  }
  return { title: t, artist: '' };
}

// 1行を解析。タイムスタンプが無ければ null
function parseLine(line) {
  const stamps = [];
  let m;
  TS_RE.lastIndex = 0;
  while ((m = TS_RE.exec(line)) !== null) {
    stamps.push({ index: m.index, length: m[0].length, sec: parseTime(m[0]) });
  }
  if (!stamps.length) return null;

  const start = stamps[0].sec;
  let end = null;
  let consumedUntil = stamps[0].index + stamps[0].length;
  let consumedFrom = stamps[0].index;
  if (stamps.length >= 2) {
    const between = line.slice(consumedUntil, stamps[1].index);
    if (RANGE_SEP_RE.test(between) || between.trim() === '') {
      if (stamps[1].sec > start) {
        end = stamps[1].sec;
        consumedUntil = stamps[1].index + stamps[1].length;
      }
    }
  }
  const before = line.slice(0, consumedFrom);
  const after = line.slice(consumedUntil);
  // タイトルは通常タイムスタンプの後ろ。無ければ前。
  let rawTitle = cleanTitle(after);
  if (!rawTitle) rawTitle = cleanTitle(before);
  const { title, artist } = splitTitleArtist(rawTitle);
  return { title, artist, start, end, raw: line.trim() };
}

// テキスト全体を解析
// options.duration: 動画の長さ（分かっていれば最後の曲の終了に使う）
// options.gap: 次の曲の開始から何秒前で終了にするか（デフォルト 0）
export function parseSetlist(text, { duration = 0, gap = 0 } = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const items = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const item = parseLine(line);
    if (item) items.push(item);
  }
  // 開始時刻順に並べ替え（コメントは大抵順序通りだが念のため）
  items.sort((a, b) => a.start - b.start);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.end == null) {
      const next = items[i + 1];
      if (next && next.start > it.start) {
        it.end = Math.max(it.start, next.start - gap);
      } else if (duration > it.start) {
        it.end = duration;
      } else {
        it.end = 0; // 不明 → 動画の最後まで
      }
    }
    if (!it.title) it.title = `シーン ${i + 1}`;
  }
  return items;
}

// 曲配列 → YouTube コメント形式のセットリスト文字列
export function songsToSetlist(songs, { withEnd = false } = {}) {
  return songs.map(s => {
    const t = withEnd && s.end > s.start
      ? `${formatTime(s.start)} - ${formatTime(s.end)}`
      : formatTime(s.start);
    const name = s.artist ? `${s.title} / ${s.artist}` : s.title;
    return `${t} ${name}`;
  }).join('\n');
}
