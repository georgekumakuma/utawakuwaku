// アプリ全体の状態ストア
// state を直接書き換えたあと commit('topic') で購読者に通知する、小さく明示的な設計。
// 'data' の変更は自動で永続化（デバウンス）、'settings' は即時保存。

import * as storage from './storage.js';
import {
  emptyData, sanitizeData, sanitizeSettings, migrateV1, migrateV2, newPlaylist, normalizeSong,
  uniqueName, DEFAULT_SETTINGS, sanitizeBanks
} from './model.js';
import { csvToSongs } from './csv.js';

const listeners = new Map(); // topic → Set<fn>

export const state = {
  data: emptyData(),
  settings: { ...DEFAULT_SETTINGS },
  history: [],         // [{songId, playlistId, videoId, title, at}] 新しい順
  ui: {
    view: 'playlist',  // 'playlist' | 'library' | 'history' | 'bank' | 'queue'
    search: '',
    sort: 'manual',    // 'manual' | 'title' | 'rating' | 'recent' | 'plays' | 'length'
    filterRating: 0,
    filterTag: '',
    filterVersion: null, // { title } 同じ曲の別バージョンだけを表示
    filterBroken: false, // リンク切れの曲だけを表示
    sleep: null,         // スリープタイマー { mode: 'time', until } | { mode: 'song' }
    selection: new Set(),
    anchorId: null,
    editingId: null,   // 編集中の曲ID（null なら新規）
    editorOpen: false,
    sidebarOpen: false,
    panel: 'editor',   // 右パネル: 'editor' | 'queue'
    bank: [],          // [{id,name,description,file,icon,count?}]
    playerReady: false,
    playerError: ''
  }
};

export function on(topic, fn) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(fn);
  return () => listeners.get(topic).delete(fn);
}

let saveTimer = null;
export function commit(...topics) {
  for (const t of topics) {
    if (t === 'data' || t === 'videos') scheduleSave();
    if (t === 'settings') storage.save('settings', state.settings);
    if (t === 'history') storage.save('history', state.history.slice(0, 300));
    const set = listeners.get(t);
    if (set) for (const fn of Array.from(set)) {
      try { fn(state); } catch (e) { console.error(`listener(${t}) failed`, e); }
    }
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}

export async function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const pl = currentPlaylist();
  if (pl) pl.updatedAt = Date.now();
  await storage.save('data', state.data);
}

// ===== 起動時の読み込み =====
export async function init() {
  const [data, settings, history] = await Promise.all([
    storage.load('data'), storage.load('settings'), storage.load('history')
  ]);
  state.settings = sanitizeSettings(settings);
  state.history = Array.isArray(history) ? history : [];

  if (data && Array.isArray(data.playlists) && data.playlists.length) {
    state.data = sanitizeData(data);
    return { source: 'saved' };
  }
  const legacy = storage.loadLegacy();
  if (legacy) {
    state.data = legacy.kind === 'v2' ? migrateV2(legacy.value) : migrateV1(legacy.value);
    if (state.data.playlists.length) {
      await flush();
      return { source: 'migrated' };
    }
  }
  // 初回: デフォルトCSV
  try {
    const res = await fetch('./playlists/utawakuwaku_playlist_default.csv');
    if (res.ok) {
      const songs = csvToSongs(await res.text());
      if (songs.length) {
        const pl = newPlaylist('マイリスト', songs, { icon: '⭐', source: 'bank:default' });
        state.data = { ...emptyData(), playlists: [pl], currentId: pl.id };
        await flush();
        return { source: 'default', count: songs.length };
      }
    }
  } catch (e) {
    console.warn('デフォルトCSVの読み込みに失敗:', e);
  }
  const pl = newPlaylist('マイリスト');
  state.data = { ...emptyData(), playlists: [pl], currentId: pl.id };
  await flush();
  return { source: 'empty' };
}

// ===== セレクタ =====
export function playlists() { return state.data.playlists; }
export function playlistById(id) { return state.data.playlists.find(p => p.id === id) || null; }
export function currentPlaylist() { return playlistById(state.data.currentId); }
export function playlistNames() { return state.data.playlists.map(p => p.name); }

export function findSong(songId) {
  for (const p of state.data.playlists) {
    const s = p.songs.find(x => x.id === songId);
    if (s) return { song: s, playlist: p };
  }
  return null;
}

// ライブラリ: 全プレイリスト横断（同じ区間は1つにまとめ、所属リストを付ける）
export function librarySongs() {
  const map = new Map();
  for (const p of state.data.playlists) {
    for (const s of p.songs) {
      const key = `${s.videoId}:${s.start}:${s.end}`;
      const e = map.get(key);
      if (e) { e.playlists.push(p); if (s.playCount > e.song.playCount) e.song = s; }
      else map.set(key, { song: s, playlists: [p] });
    }
  }
  return Array.from(map.values());
}

export function allTags() {
  const set = new Set();
  for (const p of state.data.playlists) for (const s of p.songs) for (const t of s.tags || []) set.add(t);
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
}

// ===== プレイリスト操作 =====
export function switchPlaylist(id) {
  if (!playlistById(id) || id === state.data.currentId) return false;
  state.data.currentId = id;
  state.ui.selection.clear();
  commit('data', 'ui');
  return true;
}

export function createPlaylist(name, songs = [], extra = {}) {
  const pl = newPlaylist(uniqueName(name, playlistNames()), songs, extra);
  state.data.playlists.push(pl);
  state.data.currentId = pl.id;
  state.ui.selection.clear();
  commit('data', 'ui');
  return pl;
}

export function renamePlaylist(id, name) {
  const pl = playlistById(id);
  const n = String(name || '').trim();
  if (!pl || !n) return false;
  if (playlists().some(p => p.id !== id && p.name === n)) return false;
  pl.name = n;
  commit('data');
  return true;
}

export function deletePlaylist(id) {
  const idx = state.data.playlists.findIndex(p => p.id === id);
  if (idx < 0) return null;
  const [removed] = state.data.playlists.splice(idx, 1);
  if (!state.data.playlists.length) {
    state.data.playlists.push(newPlaylist('マイリスト'));
  }
  if (state.data.currentId === id) {
    state.data.currentId = state.data.playlists[Math.min(idx, state.data.playlists.length - 1)].id;
  }
  state.ui.selection.clear();
  commit('data', 'ui');
  return removed;
}

export function restorePlaylist(pl, index) {
  state.data.playlists.splice(Math.min(index, state.data.playlists.length), 0, pl);
  state.data.currentId = pl.id;
  commit('data', 'ui');
}

export function movePlaylist(id, toIndex) {
  const from = state.data.playlists.findIndex(p => p.id === id);
  if (from < 0) return;
  const [pl] = state.data.playlists.splice(from, 1);
  state.data.playlists.splice(Math.max(0, Math.min(toIndex, state.data.playlists.length)), 0, pl);
  commit('data');
}

// ===== 曲操作 =====
export function addSongs(playlistId, songs, { at = null } = {}) {
  const pl = playlistById(playlistId);
  if (!pl) return [];
  const added = songs.map(s => normalizeSong(s)).filter(Boolean);
  if (at == null || at >= pl.songs.length) pl.songs.push(...added);
  else pl.songs.splice(Math.max(0, at), 0, ...added);
  commit('data');
  return added;
}

export function updateSong(songId, patch) {
  const found = findSong(songId);
  if (!found) return null;
  const next = normalizeSong({ ...found.song, ...patch, id: songId });
  Object.assign(found.song, next);
  commit('data');
  return found.song;
}

export function removeSongs(playlistId, songIds) {
  const pl = playlistById(playlistId);
  if (!pl) return [];
  const ids = new Set(songIds);
  const removed = [];
  pl.songs = pl.songs.filter((s, i) => {
    if (ids.has(s.id)) { removed.push({ song: s, index: i }); return false; }
    return true;
  });
  for (const id of ids) state.ui.selection.delete(id);
  commit('data', 'ui');
  return removed;
}

export function restoreSongs(playlistId, removed) {
  const pl = playlistById(playlistId);
  if (!pl) return;
  removed.slice().sort((a, b) => a.index - b.index).forEach(({ song, index }) => {
    pl.songs.splice(Math.min(index, pl.songs.length), 0, song);
  });
  commit('data');
}

export function moveSongs(playlistId, songIds, toIndex) {
  const pl = playlistById(playlistId);
  if (!pl) return;
  const ids = new Set(songIds);
  const moving = pl.songs.filter(s => ids.has(s.id));
  if (!moving.length) return;
  const before = pl.songs.slice(0, toIndex).filter(s => !ids.has(s.id));
  const after = pl.songs.slice(toIndex).filter(s => !ids.has(s.id));
  pl.songs = [...before, ...moving, ...after];
  commit('data');
}

export function reorderSongs(playlistId, orderedIds) {
  const pl = playlistById(playlistId);
  if (!pl) return;
  const map = new Map(pl.songs.map(s => [s.id, s]));
  const next = orderedIds.map(id => map.get(id)).filter(Boolean);
  if (next.length === pl.songs.length) { pl.songs = next; commit('data'); }
}

export function recordPlay(song, playlist) {
  song.playCount = (song.playCount || 0) + 1;
  song.lastPlayedAt = Date.now();
  state.history.unshift({
    songId: song.id, playlistId: playlist ? playlist.id : null,
    videoId: song.videoId, title: song.title, article: song.article, start: song.start, end: song.end, at: Date.now()
  });
  if (state.history.length > 300) state.history.length = 300;
  commit('data', 'history');
}

// ===== UI =====
export function setView(view) {
  if (state.ui.view === view) return;
  state.ui.view = view;
  state.ui.selection.clear();
  state.ui.search = '';
  state.ui.filterVersion = null;
  state.ui.filterBroken = false;
  withTransition(() => commit('ui'));
}

// 画面の切り替えをなめらかに（View Transitions API。未対応・動きを減らす設定ではそのまま）
export function withTransition(fn) {
  const doc = typeof document !== 'undefined' ? document : null;
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc || !doc.startViewTransition || reduce || doc.hidden) { fn(); return; }
  try { doc.startViewTransition(fn); } catch { fn(); }
}

export function setSetting(key, value) {
  if (state.settings[key] === value) return;
  state.settings[key] = value;
  commit('settings');
}

export function exportJSON() {
  return JSON.stringify({
    app: 'utawakuwaku', version: state.data.version, exportedAt: new Date().toISOString(),
    playlists: state.data.playlists, banks: state.data.banks || [], videos: state.data.videos || {},
    settings: withoutSecrets(state.settings)
  }, null, 2);
}

// バックアップに個人の API キーを含めない（ファイルを人に渡しても漏れないように）
function withoutSecrets(settings) {
  const rest = { ...(settings || {}) };
  delete rest.ytApiKey;
  return rest;
}

// JSON バックアップの取り込み。mode: 'merge'（追加）| 'replace'（置き換え）
export function importJSON(text, mode = 'merge') {
  const obj = JSON.parse(text);
  const incoming = sanitizeData(obj);
  if (!incoming.playlists.length) throw new Error('プレイリストが含まれていません');
  if (mode === 'replace') {
    state.data = incoming;
  } else {
    for (const p of incoming.playlists) {
      p.name = uniqueName(p.name, playlistNames());
      if (playlistById(p.id)) p.id = newPlaylist('x').id;
      state.data.playlists.push(p);
    }
    state.data.currentId = incoming.playlists[0].id;
    for (const b of incoming.banks || []) if (!bankByUrl(b.url)) banks().push(b);
    state.data.videos = { ...(incoming.videos || {}), ...(state.data.videos || {}) };
  }
  if (obj.settings) state.settings = sanitizeSettings({ ...state.settings, ...withoutSecrets(obj.settings), ytApiKey: state.settings.ytApiKey });
  state.ui.selection.clear();
  commit('data', 'settings', 'ui');
  return incoming.playlists.length;
}

// ===== 共有バンク =====
export function banks() { return state.data.banks || (state.data.banks = []); }
export function bankById(id) { return banks().find(b => b.id === id) || null; }
export function bankByUrl(url) { return banks().find(b => b.url === url) || null; }

export function saveBank(info) {
  const list = banks();
  const existing = list.find(b => b.url === info.url);
  if (existing) { Object.assign(existing, info, { id: existing.id, addedAt: existing.addedAt }); commit('data'); return existing; }
  const [b] = sanitizeBanks([{ ...info, addedAt: Date.now() }]);
  list.unshift(b);
  commit('data');
  return b;
}

export function removeBank(id) {
  const list = banks();
  const i = list.findIndex(b => b.id === id);
  if (i < 0) return null;
  const [removed] = list.splice(i, 1);
  commit('data');
  return { removed, index: i };
}

export function restoreBank(b, index) {
  banks().splice(Math.min(index, banks().length), 0, b);
  commit('data');
}

export function replaceSongs(playlistId, songs) {
  const pl = playlistById(playlistId);
  if (!pl) return null;
  pl.songs = songs.map(s => normalizeSong({ ...s, id: undefined })).filter(Boolean);
  commit('data');
  return pl;
}

// ===== 動画情報 =====
export function videoDuration(videoId) {
  const v = state.data.videos && state.data.videos[videoId];
  return v ? v.duration : 0;
}

export function rememberDuration(videoId, duration) {
  if (!videoId || !(duration > 0)) return;
  if (!state.data.videos) state.data.videos = {};
  const d = Math.round(duration);
  const cur = state.data.videos[videoId];
  if (cur && Math.abs(cur.duration - d) <= 1) return;
  state.data.videos[videoId] = { duration: d };
  commit('videos'); // 保存のみ（表示中の画面は作り直さない）
}

// 配信（動画）ごとにまとめる
export function videoGroups() {
  const map = new Map();
  for (const { song, playlists: pls } of librarySongs()) {
    let g = map.get(song.videoId);
    if (!g) { g = { videoId: song.videoId, songs: [], playlists: new Set(), titles: new Map(), singer: '', addedAt: 0, plays: 0, lastPlayedAt: 0 }; map.set(song.videoId, g); }
    g.songs.push({ song, playlistId: pls[0].id });
    pls.forEach(p => g.playlists.add(p));
    if (song.article) g.titles.set(song.article, (g.titles.get(song.article) || 0) + 1);
    if (!g.singer && song.singer) g.singer = song.singer;
    g.addedAt = Math.max(g.addedAt, song.addedAt || 0);
    g.plays += song.playCount || 0;
    g.lastPlayedAt = Math.max(g.lastPlayedAt, song.lastPlayedAt || 0);
  }
  return Array.from(map.values()).map(g => {
    g.songs.sort((a, b) => a.song.start - b.song.start);
    const title = Array.from(g.titles.entries()).sort((a, b) => b[1] - a[1])[0];
    const maxEnd = Math.max(...g.songs.map(x => Math.max(x.song.end, x.song.start)));
    return { ...g, title: title ? title[0] : '', duration: videoDuration(g.videoId), maxEnd };
  });
}
