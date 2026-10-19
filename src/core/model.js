// データモデル（曲・プレイリスト・ストア全体）と正規化・移行

import { roundTenth } from './time.js';

export const DATA_VERSION = 3;
export const MAX_RATING = 6;

let idCounter = 0;
export function newId(prefix = 's') {
  idCounter = (idCounter + 1) % 1000;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${idCounter.toString(36)}`;
}

export function parseTags(val) {
  if (Array.isArray(val)) return val.map(t => String(t).trim()).filter(Boolean);
  if (!val) return [];
  return String(val).split(/[\s,、;；#]+/).map(t => t.trim()).filter(Boolean);
}

// 任意の入力を Song に正規化。videoId が無ければ null
export function normalizeSong(raw) {
  if (!raw || !raw.videoId) return null;
  const start = Math.max(0, roundTenth(Number(raw.start) || 0));
  let end = roundTenth(Number(raw.end) || 0);
  if (!isFinite(end) || end < 0) end = 0;
  let rating = parseInt(raw.rating, 10);
  if (!isFinite(rating)) rating = 1;
  rating = Math.min(MAX_RATING, Math.max(1, rating));
  return {
    id: raw.id || newId('s'),
    videoId: String(raw.videoId).trim(),
    title: String(raw.title || '').trim(),
    start,
    end,            // 0 または start 以下 → 動画の最後まで再生
    rating,
    article: String(raw.article || '').trim(),
    artist: String(raw.artist || '').trim(),
    singer: String(raw.singer || '').trim(),
    tags: parseTags(raw.tags),
    note: String(raw.note || '').trim(),
    addedAt: Number(raw.addedAt) || Date.now(),
    playCount: Number(raw.playCount) || 0,
    lastPlayedAt: Number(raw.lastPlayedAt) || 0,
    gain: Math.max(-50, Math.min(50, Math.round(Number(raw.gain) || 0))), // 曲ごとの音量補正（%）
    broken: typeof raw.broken === 'string' ? raw.broken : ''              // '' | 'missing' | 'restricted'
  };
}

export function hasValidEnd(song) {
  return !!song && song.end > song.start;
}

// 区間の長さ（終了未設定なら null）
export function segmentLength(song) {
  return hasValidEnd(song) ? roundTenth(song.end - song.start) : null;
}

// 同一区間の判定キー（ライブラリの重複排除に使用）
export function songKey(song) {
  return `${song.videoId}:${song.start}:${song.end}`;
}

export function cloneSong(song, { keepId = false } = {}) {
  return normalizeSong({ ...song, id: keepId ? song.id : undefined, tags: [...(song.tags || [])] });
}

export function newPlaylist(name, songs = [], extra = {}) {
  const now = Date.now();
  return {
    id: extra.id || newId('p'),
    name: String(name || '新しいプレイリスト').trim() || '新しいプレイリスト',
    icon: extra.icon || '',
    description: extra.description || '',
    songs: songs.map(s => normalizeSong(s)).filter(Boolean),
    createdAt: extra.createdAt || now,
    updatedAt: now,
    source: extra.source || ''   // 'bank:<id>' など由来の記録
  };
}

export function emptyData() {
  return { version: DATA_VERSION, playlists: [], currentId: null, banks: [] };
}

// 旧 v2 ストア（{current, lists:{name:[songs]}}）→ v3
export function migrateV2(v2) {
  const data = emptyData();
  if (!v2 || !v2.lists) return data;
  for (const [name, songs] of Object.entries(v2.lists)) {
    const pl = newPlaylist(name, Array.isArray(songs) ? songs : []);
    data.playlists.push(pl);
    if (name === v2.current) data.currentId = pl.id;
  }
  if (!data.currentId && data.playlists.length) data.currentId = data.playlists[0].id;
  return data;
}

// 旧 v1（単一配列）→ v3
export function migrateV1(arr, name = 'マイリスト') {
  const data = emptyData();
  if (!Array.isArray(arr) || !arr.length) return data;
  const pl = newPlaylist(name, arr);
  data.playlists.push(pl);
  data.currentId = pl.id;
  return data;
}

// 読み込んだ v3 データの健全性を確保
export function sanitizeData(input) {
  const data = emptyData();
  if (!input || !Array.isArray(input.playlists)) return data;
  const seen = new Set();
  for (const p of input.playlists) {
    if (!p) continue;
    const pl = newPlaylist(p.name, Array.isArray(p.songs) ? p.songs : [], {
      id: p.id, icon: p.icon, description: p.description, createdAt: p.createdAt, source: p.source
    });
    if (seen.has(pl.id)) pl.id = newId('p');
    seen.add(pl.id);
    pl.updatedAt = p.updatedAt || pl.updatedAt;
    data.playlists.push(pl);
  }
  data.currentId = data.playlists.some(p => p.id === input.currentId)
    ? input.currentId
    : (data.playlists[0] ? data.playlists[0].id : null);
  data.banks = sanitizeBanks(input.banks);
  return data;
}

// 重複しない名前を作る（"名前", "名前 2", "名前 3" ...）
export function uniqueName(base, existing) {
  const names = new Set(existing);
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export const DEFAULT_SETTINGS = {
  theme: 'dark',          // 'dark' | 'light' | 'auto'
  accent: 'aurora',       // アクセントカラーのプリセット名
  volume: 100,
  muted: false,
  rate: 1,
  crossfade: 1.5,         // 秒。0 でフェードなし
  gapless: true,          // 2デッキ先読み
  repeat: 'all',          // 'off' | 'all' | 'one'
  shuffle: false,
  showVideo: true,
  compactRows: false,
  confirmDelete: true,
  keepScreenAwake: false,
  bankSeeded: false,
  seenWelcome: false
};

export function sanitizeSettings(s) {
  const out = { ...DEFAULT_SETTINGS };
  if (!s || typeof s !== 'object') return out;
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (k in s && typeof s[k] === typeof DEFAULT_SETTINGS[k]) out[k] = s[k];
  }
  out.volume = Math.min(100, Math.max(0, Number(out.volume) || 0));
  out.crossfade = Math.min(8, Math.max(0, Number(out.crossfade) || 0));
  if (![0.5, 0.75, 1, 1.25, 1.5, 2].includes(out.rate)) out.rate = 1;
  if (!['off', 'all', 'one'].includes(out.repeat)) out.repeat = 'all';
  if (!['dark', 'light', 'auto'].includes(out.theme)) out.theme = 'dark';
  return out;
}

// 共有バンク（他の人が公開した URL）の登録情報
export function sanitizeBanks(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const b of list) {
    if (!b || typeof b.url !== 'string' || seen.has(b.url)) continue;
    seen.add(b.url);
    out.push({
      id: String(b.id || newId('b')),
      url: b.url,
      name: String(b.name || '共有バンク'),
      description: String(b.description || ''),
      icon: String(b.icon || '📚'),
      author: String(b.author || ''),
      kind: b.kind === 'bank' ? 'bank' : 'csv',
      presets: Array.isArray(b.presets) ? b.presets.filter(p => p && p.url).map(p => ({
        id: String(p.id || p.url), name: String(p.name || ''), description: String(p.description || ''), icon: String(p.icon || '🎵'), url: String(p.url)
      })) : [],
      count: Number(b.count) || 0,
      addedAt: Number(b.addedAt) || Date.now(),
      fetchedAt: Number(b.fetchedAt) || 0
    });
  }
  return out;
}
