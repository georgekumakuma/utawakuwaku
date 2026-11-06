// アプリ全体のアクション。UI コンポーネントはここを呼ぶだけにして、互いに依存しない。

import * as store from '../core/store.js';
import { state, commit } from '../core/store.js';
import { songsToCSV, csvToSongs } from '../core/csv.js';
import { songsToSetlist } from '../core/setlist.js';
import { encodeShare, buildShareUrl } from '../core/share.js';
import { cloneSong, hasValidEnd, normalizeSong } from '../core/model.js';
import { watchUrl } from '../core/ytid.js';
import { ctx } from './context.js';
import { toast, toastError, toastSuccess } from '../ui/toast.js';
import { confirmDialog, promptDialog } from '../ui/dialog.js';
import { copyText, downloadText, datestamp } from '../ui/dom.js';
import { openExternal } from '../ui/external.js';

const engine = () => ctx.engine;

// ===== 再生 =====
// items: [{song, playlistId}] を再生コンテキストにして songId から再生
export function playItems(items, songId) {
  const e = engine();
  if (!e || !e.ready) { toastError(state.ui.playerError || 'YouTubeプレイヤーの準備ができていません'); return; }
  if (!items.length) return;
  state.ui.radio = false;
  e.setContext(items, songId || items[0].song.id, { play: true });
}

export function itemsOfPlaylist(pl) {
  return pl ? pl.songs.map(song => ({ song, playlistId: pl.id })) : [];
}

export function playPlaylist(playlistId, { shuffle = null } = {}) {
  const pl = store.playlistById(playlistId);
  if (!pl || !pl.songs.length) { toast('プレイリストが空です'); return; }
  const e = engine();
  if (shuffle != null && e) { e.setShuffle(shuffle); store.setSetting('shuffle', shuffle); }
  const start = (shuffle || (e && e.state.shuffle)) ? pl.songs[Math.floor(Math.random() * pl.songs.length)].id : pl.songs[0].id;
  playItems(itemsOfPlaylist(pl), start);
}

// 曲を再生。表示中のリスト（items）があればそれをコンテキストにする
export function playSong(songId, items = null) {
  const e = engine();
  if (!e) return;
  if (items) { playItems(items, songId); return; }
  if (e.playSongInContext(songId)) return;
  const found = store.findSong(songId);
  if (found) playItems(itemsOfPlaylist(found.playlist), songId);
}

export function enqueue(items, { next = false } = {}) {
  const e = engine();
  if (!e) return;
  e.enqueue(items.map(it => ({ song: it.song, playlistId: it.playlistId })), { next });
  const n = items.length;
  toast(next ? `${n}曲を「次に再生」に追加しました` : `${n}曲をキューに追加しました`, { duration: 2000 });
}

export function togglePlay() { engine() && engine().togglePlay(); }
export function next() { engine() && engine().next(); }
export function prev() { engine() && engine().prev(); }
export function stop() { engine() && engine().stop(); }

export function toggleShuffle() {
  const e = engine(); if (!e) return;
  const on = !e.state.shuffle;
  e.setShuffle(on);
  store.setSetting('shuffle', on);
  toast(on ? 'シャッフル ON' : 'シャッフル OFF', { duration: 1400 });
}

export function cycleRepeat() {
  const e = engine(); if (!e) return;
  const order = ['all', 'one', 'off'];
  const nextMode = order[(order.indexOf(e.state.repeat) + 1) % order.length];
  e.setRepeat(nextMode);
  store.setSetting('repeat', nextMode);
  toast({ all: 'リピート: 全曲', one: 'リピート: 1曲', off: 'リピート OFF' }[nextMode], { duration: 1400 });
}

export function setVolume(v) {
  const e = engine(); if (!e) return;
  e.setVolume(v);
  store.setSetting('volume', v);
  if (v > 0) store.setSetting('muted', false);
}

export function toggleMute() {
  const e = engine(); if (!e) return;
  const m = !e.state.muted;
  e.setMuted(m);
  store.setSetting('muted', m);
}

export function setRate(r) {
  const e = engine(); if (!e) return;
  e.setRate(r);
  store.setSetting('rate', r);
}

// ===== 曲の編集 =====
export function openEditor(songId = null, draft = null) {
  state.ui.editingId = songId;
  state.ui.draft = draft;            // 新規時のドラフト（videoId など）
  state.ui.editorOpen = true;
  state.ui.panel = 'editor';
  commit('ui');
}

export function closeEditor() {
  state.ui.editorOpen = false;
  state.ui.editingId = null;
  state.ui.draft = null;
  commit('ui');
}

export function showPanel(name) {
  state.ui.panel = name;
  state.ui.editorOpen = true;
  commit('ui');
}

export function togglePanel(name) {
  if (state.ui.editorOpen && state.ui.panel === name) { state.ui.editorOpen = false; }
  else { state.ui.panel = name; state.ui.editorOpen = true; }
  commit('ui');
}

export function rateSong(songId, rating) {
  store.updateSong(songId, { rating });
}

export async function deleteSongs(playlistId, songIds) {
  const pl = store.playlistById(playlistId);
  if (!pl || !songIds.length) return;
  if (state.settings.confirmDelete && songIds.length > 1) {
    const ok = await confirmDialog(`${songIds.length}曲を「${pl.name}」から削除しますか？`, { okLabel: '削除', danger: true });
    if (!ok) return;
  }
  const removed = store.removeSongs(playlistId, songIds);
  if (!removed.length) return;
  if (state.ui.editingId && songIds.includes(state.ui.editingId)) closeEditor();
  const label = removed.length === 1 ? `「${removed[0].song.title}」を削除しました` : `${removed.length}曲を削除しました`;
  toast(label, {
    duration: 6000,
    action: { text: '元に戻す', callback: () => { store.restoreSongs(playlistId, removed); toast('削除を取り消しました', { duration: 1500 }); } }
  });
}

export function duplicateSongs(playlistId, songIds) {
  const pl = store.playlistById(playlistId);
  if (!pl) return;
  const copies = pl.songs.filter(s => songIds.includes(s.id)).map(s => cloneSong(s));
  const lastIdx = Math.max(...songIds.map(id => pl.songs.findIndex(s => s.id === id)));
  store.addSongs(playlistId, copies, { at: lastIdx + 1 });
  toast(`${copies.length}曲を複製しました`, { duration: 1500 });
}

export function copySongsTo(targetPlaylistId, songs) {
  const target = store.playlistById(targetPlaylistId);
  if (!target) return;
  store.addSongs(targetPlaylistId, songs.map(s => cloneSong(s)));
  toastSuccess(`${songs.length}曲を「${target.name}」に追加しました`);
}

export async function moveSongsTo(targetPlaylistId, fromPlaylistId, songIds) {
  const from = store.playlistById(fromPlaylistId);
  const target = store.playlistById(targetPlaylistId);
  if (!from || !target || from === target) return;
  const songs = from.songs.filter(s => songIds.includes(s.id));
  store.removeSongs(fromPlaylistId, songIds);
  store.addSongs(targetPlaylistId, songs);
  toastSuccess(`${songs.length}曲を「${target.name}」へ移動しました`);
}

export function openOnYouTube(song) {
  openExternal(watchUrl(song.videoId, song.start), { label: 'YouTube' });
}

export async function copyYouTubeLink(song) {
  const ok = await copyText(watchUrl(song.videoId, song.start));
  toast(ok ? 'YouTubeのリンクをコピーしました' : 'コピーできませんでした', { duration: 1800 });
}

// ===== プレイリスト =====
export async function createPlaylistDialog() {
  const name = await promptDialog('', { title: '新しいプレイリスト', placeholder: 'プレイリスト名' });
  if (!name) return null;
  const pl = store.createPlaylist(name);
  store.setView('playlist');
  toastSuccess(`「${pl.name}」を作成しました`);
  return pl;
}

export async function renamePlaylistDialog(playlistId) {
  const pl = store.playlistById(playlistId);
  if (!pl) return;
  const name = await promptDialog('', { title: '名前を変更', value: pl.name, validate: v => !v ? '入力してください' : (store.playlists().some(p => p.id !== playlistId && p.name === v) ? '同じ名前のプレイリストがあります' : '') });
  if (!name || name === pl.name) return;
  store.renamePlaylist(playlistId, name);
}

export async function deletePlaylistDialog(playlistId) {
  const pl = store.playlistById(playlistId);
  if (!pl) return;
  const ok = await confirmDialog(`プレイリスト「${pl.name}」（${pl.songs.length}曲）を削除しますか？`, { okLabel: '削除', danger: true });
  if (!ok) return;
  const idx = store.playlists().indexOf(pl);
  const removed = store.deletePlaylist(playlistId);
  if (!removed) return;
  if (ctx.engine && ctx.engine.state.playlistId === playlistId) ctx.engine.stop();
  toast(`「${removed.name}」を削除しました`, {
    duration: 7000,
    action: { text: '元に戻す', callback: () => store.restorePlaylist(removed, idx) }
  });
}

export function duplicatePlaylist(playlistId) {
  const pl = store.playlistById(playlistId);
  if (!pl) return;
  const copy = store.createPlaylist(`${pl.name} のコピー`, pl.songs.map(s => cloneSong(s)), { icon: pl.icon });
  toastSuccess(`「${copy.name}」を作成しました`);
}

export async function sharePlaylist(playlistId) {
  const pl = store.playlistById(playlistId);
  if (!pl || !pl.songs.length) { toast('プレイリストが空です'); return; }
  try {
    const hash = await encodeShare({ name: pl.name, songs: pl.songs });
    const url = buildShareUrl(hash);
    if (navigator.share && ctx.isTouch) {
      try { await navigator.share({ title: `utawakuwaku: ${pl.name}`, url }); return; } catch { /* fallthrough */ }
    }
    const ok = await copyText(url);
    toast(ok ? `共有URLをコピーしました（${Math.round(url.length / 1024 * 10) / 10}KB）。開くとプレイリストを取り込めます` : 'コピーできませんでした', { duration: 4000 });
  } catch (e) {
    toastError('共有URLを作成できませんでした: ' + e.message);
  }
}

export function exportCSV(playlistId) {
  const pl = store.playlistById(playlistId);
  if (!pl) return;
  const csv = songsToCSV(pl.songs);
  const safe = pl.name.replace(/[\\/:*?"<>|]/g, '_');
  downloadText(`utawakuwaku_${safe}_${datestamp()}.csv`, csv, 'text/csv');
  toastSuccess('CSVを保存しました');
}

export async function copyCSV(playlistId) {
  const pl = store.playlistById(playlistId);
  if (!pl) return;
  const ok = await copyText(songsToCSV(pl.songs));
  toast(ok ? 'CSVをクリップボードにコピーしました' : 'コピーできませんでした');
}

export async function copySetlist(playlistId) {
  const pl = store.playlistById(playlistId);
  if (!pl) return;
  const ok = await copyText(songsToSetlist(pl.songs));
  toast(ok ? 'タイムスタンプ付きセットリストをコピーしました（YouTubeコメント形式）' : 'コピーできませんでした', { duration: 3500 });
}

export function exportAllJSON() {
  downloadText(`utawakuwaku_backup_${datestamp()}.json`, store.exportJSON(), 'application/json');
  toastSuccess('バックアップ（JSON）を保存しました');
}

// ===== インポート =====
export function importSongs(songs, { mode = 'new', name = 'インポート', playlistId = null, source = '' } = {}) {
  if (!songs.length) throw new Error('曲が含まれていません');
  if (mode === 'new') {
    const pl = store.createPlaylist(name, songs, { source });
    store.setView('playlist');
    toastSuccess(`「${pl.name}」を作成しました（${songs.length}曲）`);
    return pl;
  }
  const target = store.playlistById(playlistId || state.data.currentId);
  if (!target) throw new Error('追加先のプレイリストがありません');
  store.addSongs(target.id, songs);
  toastSuccess(`「${target.name}」に${songs.length}曲を追加しました`);
  return target;
}

export function importCSVText(text, opts = {}) {
  const songs = csvToSongs(text);
  if (!songs.length) throw new Error('CSVの形式が正しくないか、曲が含まれていません');
  return importSongs(songs, opts);
}

export async function importFile(file) {
  const text = await file.text();
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.json') || text.trim().startsWith('{')) {
    const n = store.importJSON(text, 'merge');
    toastSuccess(`バックアップから${n}個のプレイリストを取り込みました`);
    store.setView('playlist');
    return;
  }
  const base = file.name.replace(/\.[^.]+$/, '');
  importCSVText(text, { mode: 'new', name: base });
}

// プレイリストバンクのプリセットを読み込む
export async function loadBankPreset(preset) {
  const { fetchBankCSV } = await import('./bank.js');
  const songs = await fetchBankCSV(preset.file);
  const pl = store.createPlaylist(preset.name, songs, { icon: preset.icon, description: preset.description, source: `bank:${preset.id}` });
  store.setView('playlist');
  toastSuccess(`「${pl.name}」を読み込みました（${songs.length}曲）`);
  return pl;
}

// 曲の長さの合計（終了未設定の曲は数えない）
export function totalLength(songs) {
  return songs.reduce((a, s) => a + (hasValidEnd(s) ? s.end - s.start : 0), 0);
}

// 編集中ドラフト（新規）を作る
export function makeDraft(partial = {}) {
  return normalizeSong({ videoId: partial.videoId || 'xxxxxxxxxxx', title: '', start: 0, end: 0, rating: 3, ...partial });
}

// ===== スリープタイマー =====
// mode: 分数（数値）| 'song'（この曲の終わりで停止）| null（解除）
let sleepTimer = null;
export function setSleepTimer(mode) {
  const e = engine(); if (!e) return;
  clearTimeout(sleepTimer);
  sleepTimer = null;
  e.stopAfterCurrent = false;
  state.ui.sleep = null;
  if (mode === 'song') {
    e.stopAfterCurrent = true;
    state.ui.sleep = { mode: 'song' };
    toast('この曲の終わりで停止します', { duration: 2000 });
  } else if (typeof mode === 'number' && mode > 0) {
    const until = Date.now() + mode * 60000;
    state.ui.sleep = { mode: 'time', until };
    sleepTimer = setTimeout(async () => {
      sleepTimer = null;
      state.ui.sleep = null;
      commit('ui');
      const deck = e.activeDeck;
      if (deck && (e.state.status === 'playing' || e.state.status === 'loading')) {
        await deck.fade(deck.volume, 0, 4000);
        e.pause();
        e.applyVolume();
      }
      toast('スリープタイマー: 再生を停止しました', { duration: 4000 });
    }, mode * 60000);
    toast(`${mode}分後に停止します`, { duration: 2000 });
  } else {
    toast('スリープタイマーを解除しました', { duration: 1500 });
  }
  commit('ui');
}

export function clearSleepState() {
  state.ui.sleep = null;
  commit('ui');
}

// ===== 同じ曲の別バージョン =====
export function showVersions(song) {
  state.ui.view = 'library';
  state.ui.search = '';
  state.ui.selection.clear();
  state.ui.filterVersion = { title: song.title };
  commit('ui');
}

// ===== リンク切れチェック =====
// oEmbed は削除済みで 404、非公開・埋め込み禁止で 401/403 を返す。ネットワーク失敗は判定しない。
let checking = false;
export async function checkBrokenLinks() {
  if (checking) { toast('チェック中です'); return; }
  checking = true;
  const all = [];
  for (const p of store.playlists()) for (const s of p.songs) all.push(s);
  const ids = Array.from(new Set(all.map(s => s.videoId)));
  const result = new Map();
  const progress = toast(`リンク切れをチェック中… 0 / ${ids.length}`, { duration: 0 });
  let done = 0, failed = 0;
  const worker = async () => {
    while (ids.length) {
      const id = ids.shift();
      try {
        const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}&format=json`);
        if (res.ok) result.set(id, '');
        else if (res.status === 404 || res.status === 400) result.set(id, 'missing');
        else if (res.status === 401 || res.status === 403) result.set(id, 'restricted');
      } catch { failed++; }
      done++;
      progress.setMessage(`リンク切れをチェック中… ${done} / ${done + ids.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  let broken = 0;
  for (const s of all) {
    if (!result.has(s.videoId)) continue;
    s.broken = result.get(s.videoId);
    if (s.broken) broken++;
  }
  commit('data');
  progress.dismiss();
  checking = false;
  if (failed && failed === done) { toastError('YouTube に接続できなかったため、チェックできませんでした'); return; }
  if (broken) {
    toast(`${broken}曲が再生できない可能性があります（⚠ 印）`, { duration: 6000, action: { text: '表示', callback: () => { state.ui.view = 'library'; state.ui.filterBroken = true; state.ui.filterVersion = null; commit('ui'); } } });
  } else {
    toastSuccess(`リンク切れはありませんでした（${result.size}本の動画）${failed ? `・${failed}本は確認できず` : ''}`);
  }
}

export function markBroken(videoId, reason) {
  let changed = false;
  for (const p of store.playlists()) for (const s of p.songs) {
    if (s.videoId === videoId && s.broken !== reason) { s.broken = reason; changed = true; }
  }
  if (changed) commit('data');
}

// ===== おまかせラジオ =====
export async function playRadio() {
  const e = engine();
  if (!e || !e.ready) { toastError(state.ui.playerError || 'YouTubeプレイヤーの準備ができていません'); return; }
  const { radioPick } = await import('../core/insights.js');
  const items = store.librarySongs().map(({ song, playlists }) => ({ song, playlistId: playlists[0].id }));
  const picked = radioPick(items, Math.min(150, items.length));
  if (!picked.length) { toast('ライブラリに曲がありません'); return; }
  e.setShuffle(false);
  store.setSetting('shuffle', false);
  e.setRepeat('all');
  store.setSetting('repeat', 'all');
  e.setContext(picked, picked[0].song.id, { play: true });
  state.ui.radio = true;
  commit('ui');
  toast(`📻 おまかせラジオ: 評価の高い曲・しばらく聴いていない曲を中心に${picked.length}曲を選びました`, { duration: 3500 });
}
