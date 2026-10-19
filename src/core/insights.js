// ライブラリの分析: 同じ曲の別バージョン、タグ候補、統計

import { hasValidEnd } from './model.js';

// 曲名を比較用に正規化（全角半角・大小・括弧の注記・記号・空白の違いを吸収）
export function normalizeTitle(title) {
  let t = String(title || '').normalize('NFKC').toLowerCase();
  // 注記（(cover) / 【歌ってみた】 / [short ver.] など）を除去。ただし全体が括弧なら中身を残す
  const stripped = t.replace(/[(\[【［〔][^)\]】］〕]*[)\]】］〕]/g, ' ').trim();
  if (stripped) t = stripped;
  t = t.replace(/[()[\]【】［］〔〕\s　・･\-–—_~〜～!?！？。、,.'"“”‘’「」『』:;／/♪☆★]+/g, '');
  return t;
}

// [{song, ...}] を曲名でまとめる。2件以上のグループだけ返す
export function groupVersions(items) {
  const map = new Map();
  for (const it of items) {
    const key = normalizeTitle(it.song.title);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  for (const [k, v] of map) if (v.length < 2) map.delete(k);
  return map;
}

const GENERIC_TAGS = new Set(['shorts', 'short', 'vtuber', 'live', 'ライブ', '配信', '雑談', 'archive', 'アーカイブ']);

// 配信タイトルの【】内と #ハッシュタグから、タグ候補を作る
export function suggestTags(song, existing = []) {
  const have = new Set((existing || []).map(t => t.toLowerCase()));
  const out = [];
  const add = (t) => {
    const v = String(t || '').normalize('NFKC').trim().replace(/^#/, '');
    if (!v || v.length > 20 || /^\d+$/.test(v)) return;
    const k = v.toLowerCase();
    if (have.has(k) || GENERIC_TAGS.has(k) || out.some(x => x.toLowerCase() === k)) return;
    out.push(v);
  };
  const text = `${song.article || ''} ${song.title || ''}`;
  for (const m of text.matchAll(/【([^】]+)】/g)) {
    for (const part of m[1].split(/[\/／・&＆×x\s]+/)) add(part);
  }
  for (const m of text.matchAll(/[#＃]([^\s#＃、,]+)/g)) add(m[1]);
  return out.slice(0, 8);
}

function segLen(s) { return hasValidEnd(s) ? s.end - s.start : 0; }

function topN(map, n, by = 'plays') {
  return Array.from(map.values()).sort((a, b) => b[by] - a[by] || b.count - a.count).slice(0, n);
}

// 統計
export function computeStats(playlists, history, { now = Date.now() } = {}) {
  const seen = new Set();
  const unique = [];
  for (const p of playlists) for (const s of p.songs) {
    const key = `${s.videoId}:${s.start}:${s.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
  }
  const totalLength = unique.reduce((a, s) => a + segLen(s), 0);
  const totalPlays = unique.reduce((a, s) => a + (s.playCount || 0), 0);
  const listened = history.reduce((a, h) => a + (h.end > h.start ? h.end - h.start : 0), 0);

  const bySinger = new Map();
  const byArtist = new Map();
  for (const s of unique) {
    const singer = s.singer || '';
    if (singer) {
      const e = bySinger.get(singer) || { name: singer, count: 0, plays: 0 };
      e.count++; e.plays += s.playCount || 0; bySinger.set(singer, e);
    }
    if (s.artist) {
      const e = byArtist.get(s.artist) || { name: s.artist, count: 0, plays: 0 };
      e.count++; e.plays += s.playCount || 0; byArtist.set(s.artist, e);
    }
  }

  const hours = new Array(24).fill(0);
  const days = 30;
  const daily = new Array(days).fill(0);
  const dayMs = 86400000;
  const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
  for (const h of history) {
    const d = new Date(h.at);
    hours[d.getHours()]++;
    const diff = Math.floor((today0.getTime() + dayMs - h.at) / dayMs);
    if (diff >= 0 && diff < days) daily[days - 1 - diff]++;
  }

  const topSongs = unique.filter(s => s.playCount > 0)
    .sort((a, b) => b.playCount - a.playCount || (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0)).slice(0, 10);
  const ratings = [0, 0, 0, 0, 0, 0];
  for (const s of unique) ratings[Math.min(6, Math.max(1, s.rating)) - 1]++;

  return {
    songCount: unique.length,
    playlistCount: playlists.length,
    videoCount: new Set(unique.map(s => s.videoId)).size,
    totalLength, totalPlays, listened,
    historyCount: history.length,
    topSongs,
    topSingers: topN(bySinger, 8, 'count'),
    topArtists: topN(byArtist, 8, 'count'),
    hours, daily, ratings,
    neverPlayed: unique.filter(s => !s.playCount).length,
    broken: unique.filter(s => s.broken).length
  };
}
