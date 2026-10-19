// アプリ全体の状態ストア
// state を直接書き換えたあと commit('topic') で購読者に通知する、小さく明示的な設計。
// 'data' の変更は自動で永続化（デバウンス）、'settings' は即時保存。

import * as storage from './storage.js';
import {
  emptyData, sanitizeData, sanitizeSettings, migrateV1, migrateV2, newPlaylist, normalizeSong,
  uniqueName, DEFAULT_SETTINGS
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
    if (t === 'data') scheduleSave();
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
  commit('ui');
}

export function setSetting(key, value) {
  if (state.settings[key] === value) return;
  state.settings[key] = value;
  commit('settings');
}

export function exportJSON() {
  return JSON.stringify({
    app: 'utawakuwaku', version: state.data.version, exportedAt: new Date().toISOString(),
    playlists: state.data.playlists, settings: state.settings
  }, null, 2);
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
  }
  if (obj.settings) state.settings = sanitizeSettings({ ...state.settings, ...obj.settings });
  state.ui.selection.clear();
  commit('data', 'settings', 'ui');
  return incoming.playlists.length;
}
