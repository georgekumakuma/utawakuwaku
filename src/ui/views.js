// メインコンテンツのビュー: プレイリスト / ライブラリ / 履歴 / キュー / バンク

import { h, icon } from './dom.js';
import * as store from '../core/store.js';
import { state, commit } from '../core/store.js';
import * as actions from '../app/actions.js';
import { ctx } from '../app/context.js';
import { SongList } from './songlist.js';
import { showMenu } from './menu.js';
import { openSongMenu } from '../app/songmenu.js';
import { formatDurationHuman, formatRelative } from '../core/time.js';
import { hasValidEnd, normalizeSong } from '../core/model.js';
import { listBankPresets, countBankCSV } from '../app/bank.js';
import { toastError } from './toast.js';
import { confirmDialog } from './dialog.js';
import { openAddModal } from './addmodal.js';
import { normalizeTitle, computeStats } from '../core/insights.js';

const SORTS = [
  ['manual', '手動（リスト順）'], ['title', '曲名'], ['artist', 'アーティスト'], ['rating', '評価が高い順'],
  ['length', '長い順'], ['recent', '最近追加'], ['plays', 'よく聴く順'], ['lastplayed', '最近聴いた順']
];

function matches(song, query) {
  if (!query) return true;
  const hay = `${song.title} ${song.artist} ${song.article} ${song.singer} ${(song.tags || []).map(t => '#' + t).join(' ')} ${song.videoId}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(t => hay.includes(t));
}

function sortItems(items, sort) {
  const by = (fn, dir = 1) => items.slice().sort((a, b) => { const x = fn(a.song), y = fn(b.song); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  switch (sort) {
    case 'title': return items.slice().sort((a, b) => a.song.title.localeCompare(b.song.title, 'ja'));
    case 'artist': return items.slice().sort((a, b) => (a.song.artist || '').localeCompare(b.song.artist || '', 'ja') || a.song.title.localeCompare(b.song.title, 'ja'));
    case 'rating': return by(s => s.rating, -1);
    case 'length': return by(s => hasValidEnd(s) ? s.end - s.start : 0, -1);
    case 'recent': return by(s => s.addedAt || 0, -1);
    case 'plays': return by(s => s.playCount || 0, -1);
    case 'lastplayed': return by(s => s.lastPlayedAt || 0, -1);
    default: return items;
  }
}

function filterItems(items) {
  const { search, filterRating, filterTag, filterVersion, filterBroken } = state.ui;
  const vkey = filterVersion ? normalizeTitle(filterVersion.title) : null;
  return items.filter(it => matches(it.song, search) &&
    (!filterRating || it.song.rating >= filterRating) &&
    (!filterTag || (it.song.tags || []).includes(filterTag)) &&
    (!vkey || normalizeTitle(it.song.title) === vkey) &&
    (!filterBroken || !!it.song.broken));
}

function filterPills() {
  const pills = [];
  if (state.ui.filterVersion) pills.push(h('span.filter-pill', `「${state.ui.filterVersion.title}」のバージョン`,
    h('button', { type: 'button', title: '絞り込みを解除', onclick: () => { state.ui.filterVersion = null; commit('ui'); } }, icon('close'))));
  if (state.ui.filterBroken) pills.push(h('span.filter-pill', 'リンク切れのみ',
    h('button', { type: 'button', title: '絞り込みを解除', onclick: () => { state.ui.filterBroken = false; commit('ui'); } }, icon('close'))));
  return pills;
}

export function mountViews(root) {
  const lists = {};
  let currentView = null;
  let currentItems = [];
  const head = h('div.view-head-wrap');
  const body = h('div.view-body');
  root.append(head, body);

  function getList(key, opts) {
    if (!lists[key]) {
      const c = h('div.view-list');
      lists[key] = { el: c, list: new SongList(c, opts) };
    }
    return lists[key];
  }

  function rowHeight() { return state.settings.compactRows ? 44 : 60; }

  // ----- 共通: 曲リストの操作 -----
  function listOpts(extra = {}) {
    return {
      rowHeight: rowHeight(),
      onActivate: (item) => actions.playSong(item.song.id, currentItems),
      onRate: (item, v) => actions.rateSong(item.song.id, v),
      onContextMenu: (item, selected, e, anchor) => openSongMenu(item, selected, e, anchor, { playlistId: extra.playlistId ? extra.playlistId() : null, allItems: currentItems }),
      onSelectionChange: () => renderSelectionBar(),
      ...extra
    };
  }

  // ----- 選択バー -----
  const selBar = h('div.selection-bar');
  function renderSelectionBar() {
    const entry = lists[currentView];
    const sel = entry ? entry.list.selectedItems() : [];
    if (sel.length < 2) { selBar.replaceChildren(); selBar.classList.remove('show'); return; }
    const playlistId = currentView === 'playlist' ? state.data.currentId : null;
    selBar.replaceChildren(
      h('span.selection-count', `${sel.length}曲を選択中`),
      h('button.btn.btn-ghost.sm', { type: 'button', onclick: () => actions.playItems(sel, sel[0].song.id) }, icon('play'), '再生'),
      h('button.btn.btn-ghost.sm', { type: 'button', onclick: () => actions.enqueue(sel, { next: true }) }, icon('next'), '次に再生'),
      h('button.btn.btn-ghost.sm', { type: 'button', onclick: () => actions.enqueue(sel) }, icon('queue'), 'キュー'),
      h('button.btn.btn-ghost.sm', { type: 'button', onclick: (e) => openSongMenu(sel[0], sel, e, e.currentTarget, { playlistId, allItems: currentItems }) }, icon('more'), 'その他'),
      playlistId ? h('button.btn.btn-ghost.sm.danger', { type: 'button', onclick: () => actions.deleteSongs(playlistId, sel.map(it => it.song.id)) }, icon('trash'), '削除') : null,
      h('button.icon-btn.sm', { type: 'button', title: '選択解除 (Esc)', onclick: () => entry.list.clearSelection() }, icon('close'))
    );
    selBar.classList.add('show');
  }

  // ----- ツールバー（並べ替え・フィルタ） -----
  function tools({ showSort = true, tags = [] } = {}) {
    const sortSel = h('select.select.sm', { title: '並べ替え', onchange: (e) => { state.ui.sort = e.target.value; commit('ui'); } },
      ...SORTS.map(([v, l]) => h('option', { value: v, selected: state.ui.sort === v }, l)));
    const ratingBtns = h('div.chip-group', { title: '評価で絞り込み' },
      ...[0, 4, 5, 6].map(r => h('button.chip', { type: 'button', class: state.ui.filterRating === r ? 'on' : '', onclick: () => { state.ui.filterRating = r; commit('ui'); } }, r ? `★${r}+` : 'すべて')));
    const tagChips = tags.length ? h('div.chip-group.tag-chips',
      ...tags.slice(0, 20).map(t => h('button.chip.chip-tag', { type: 'button', class: state.ui.filterTag === t ? 'on' : '', onclick: () => { state.ui.filterTag = state.ui.filterTag === t ? '' : t; commit('ui'); } }, '#' + t))) : null;
    return h('div.view-tools', ...filterPills(), showSort ? sortSel : null, ratingBtns, tagChips);
  }

  function emptyState(title, desc, action) {
    return h('div.empty', h('div.empty-art', '♪'), h('h3', title), h('p', desc), action || null);
  }

  // ===== プレイリストビュー =====
  function renderPlaylist() {
    const pl = store.currentPlaylist();
    if (!pl) { head.replaceChildren(); body.replaceChildren(emptyState('プレイリストがありません', '左の＋から作成してください')); return; }
    const entry = getList('playlist', listOpts({ draggable: true, playlistId: () => state.data.currentId,
      onReorder: (ids, to) => store.moveSongs(state.data.currentId, ids, to),
      emptyContent: () => emptyState('このプレイリストは空です', 'URLを貼る・セットリストを貼る・CSVを読み込む、どれでも数秒で曲を追加できます',
        h('button.btn.btn-primary', { type: 'button', onclick: () => openAddModal() }, icon('plus'), ' 曲を追加')) }));
    const sorted = state.ui.sort === 'manual' ? actions.itemsOfPlaylist(pl) : sortItems(actions.itemsOfPlaylist(pl), state.ui.sort);
    currentItems = filterItems(sorted);
    const filtered = currentItems.length !== pl.songs.length;
    entry.list.opts.draggable = state.ui.sort === 'manual' && !filtered;
    entry.list.opts.query = state.ui.search;
    entry.list.opts.playlistId = pl.id;
    entry.list.setItems(currentItems);
    entry.list.setActive(ctx.engine && ctx.engine.state.song ? ctx.engine.state.song.id : null);

    head.replaceChildren(
      h('div.view-head',
        h('div.view-head-main',
          h('div.view-kicker', 'プレイリスト'),
          h('h1.view-title', pl.icon ? h('span.view-icon', pl.icon) : null, h('span', pl.name),
            h('button.icon-btn.sm.view-rename', { type: 'button', title: '名前を変更', onclick: () => actions.renamePlaylistDialog(pl.id) }, icon('edit'))),
          h('div.view-meta', `${pl.songs.length}曲`, pl.songs.length ? ` · 合計 ${formatDurationHuman(actions.totalLength(pl.songs))}` : '',
            filtered ? h('span.view-filtered', ` · ${currentItems.length}件を表示`) : null,
            pl.description ? h('span.view-desc', ' · ', pl.description) : null)
        ),
        h('div.view-actions',
          h('button.btn.btn-primary.btn-round', { type: 'button', title: '最初から再生', disabled: !pl.songs.length, onclick: () => actions.playItems(currentItems.length ? currentItems : actions.itemsOfPlaylist(pl), (currentItems[0] || pl.songs[0]).id) }, icon('play'), h('span.hide-sm', ' 再生')),
          h('button.btn.btn-ghost.btn-round', { type: 'button', title: 'シャッフル再生', disabled: !pl.songs.length, onclick: () => actions.playPlaylist(pl.id, { shuffle: true }) }, icon('shuffle')),
          h('button.btn.btn-ghost.btn-round', { type: 'button', title: '曲を追加', onclick: () => openAddModal() }, icon('plus')),
          h('button.btn.btn-ghost.btn-round', { type: 'button', title: 'メニュー', onclick: (e) => playlistMenu(pl, e.currentTarget) }, icon('more'))
        )
      ),
      tools({ tags: store.allTags().filter(t => pl.songs.some(s => (s.tags || []).includes(t))) }),
      selBar
    );
    body.replaceChildren(entry.el);
    renderSelectionBar();
  }

  function playlistMenu(pl, anchor) {
    showMenu([
      { label: '名前を変更', icon: 'edit', onClick: () => actions.renamePlaylistDialog(pl.id) },
      { label: '複製', icon: 'layers', onClick: () => actions.duplicatePlaylist(pl.id) },
      'sep',
      { label: '共有URLをコピー', icon: 'share', onClick: () => actions.sharePlaylist(pl.id) },
      { label: 'CSVを書き出し（ダウンロード）', icon: 'download', onClick: () => actions.exportCSV(pl.id) },
      { label: 'CSVをクリップボードにコピー', icon: 'file', onClick: () => actions.copyCSV(pl.id) },
      { label: 'セットリスト（タイムスタンプ）をコピー', icon: 'text', onClick: () => actions.copySetlist(pl.id) },
      'sep',
      { label: '全曲を次に再生', icon: 'next', onClick: () => actions.enqueue(actions.itemsOfPlaylist(pl), { next: true }) },
      { label: '全曲をキューに追加', icon: 'queue', onClick: () => actions.enqueue(actions.itemsOfPlaylist(pl)) },
      'sep',
      { label: 'プレイリストを削除', icon: 'trash', danger: true, onClick: () => actions.deletePlaylistDialog(pl.id) }
    ], { anchor });
  }

  // ===== ライブラリ =====
  function renderLibrary() {
    const entry = getList('library', listOpts({ showPlaylist: true, emptyContent: () => emptyState('ライブラリは空です', 'プレイリストに曲を追加すると、ここで横断検索できます') }));
    const all = store.librarySongs().map(({ song, playlists }) => ({ song, playlistId: playlists[0].id, playlists }));
    const sort = state.ui.sort === 'manual' ? 'title' : state.ui.sort;
    currentItems = filterItems(sortItems(all, sort));
    entry.list.opts.query = state.ui.search;
    entry.list.setItems(currentItems);
    entry.list.setActive(ctx.engine && ctx.engine.state.song ? ctx.engine.state.song.id : null);
    head.replaceChildren(
      h('div.view-head',
        h('div.view-head-main',
          h('div.view-kicker', 'すべてのプレイリストを横断'),
          h('h1.view-title', 'ライブラリ'),
          h('div.view-meta', `${all.length}曲（重複を除く） · ${store.playlists().length}プレイリスト`, currentItems.length !== all.length ? ` · ${currentItems.length}件を表示` : '')
        ),
        h('div.view-actions',
          h('button.btn.btn-primary.btn-round', { type: 'button', disabled: !currentItems.length, onclick: () => actions.playItems(currentItems, currentItems[0].song.id) }, icon('play'), h('span.hide-sm', ' 再生')),
          h('button.btn.btn-ghost.btn-round', { type: 'button', title: 'シャッフル再生', disabled: !currentItems.length, onclick: () => { ctx.engine.setShuffle(true); store.setSetting('shuffle', true); actions.playItems(currentItems, currentItems[Math.floor(Math.random() * currentItems.length)].song.id); } }, icon('shuffle')),
          h('button.btn.btn-ghost.btn-round', { type: 'button', title: '表示中の曲で新しいプレイリストを作る', disabled: !currentItems.length, onclick: async () => {
            const { promptDialog } = await import('./dialog.js');
            const name = await promptDialog('', { title: '表示中の曲から新規プレイリスト', placeholder: 'プレイリスト名', value: state.ui.search ? `検索: ${state.ui.search}` : '' });
            if (!name) return;
            store.createPlaylist(name, currentItems.map(it => ({ ...it.song, id: undefined })));
            store.setView('playlist');
          } }, icon('plus')),
          h('button.btn.btn-ghost.btn-round', { type: 'button', title: '削除・非公開になった動画を探す', onclick: () => actions.checkBrokenLinks() }, icon('flag'), h('span.hide-sm', ' リンク切れチェック'))
        )
      ),
      tools({ tags: store.allTags() }),
      selBar
    );
    body.replaceChildren(entry.el);
    renderSelectionBar();
  }

  // ===== 履歴 =====
  function renderHistory() {
    const entry = getList('history', listOpts({ showIndex: false, showPlayedAt: true, showRange: true, draggable: false,
      emptyContent: () => emptyState('再生履歴はありません', '曲を再生すると、ここに記録されます') }));
    const items = state.history.map((hEntry, i) => {
      const found = store.findSong(hEntry.songId);
      const song = found ? found.song : normalizeSong({ id: `h_${i}_${hEntry.songId}`, videoId: hEntry.videoId, title: hEntry.title, start: hEntry.start, end: hEntry.end, article: hEntry.article, rating: 1 });
      return { song: { ...song, id: `h${i}:${song.id}` }, realId: song.id, playlistId: found ? found.playlist.id : null, at: hEntry.at, exists: !!found };
    });
    currentItems = filterItems(items);
    entry.list.opts.query = state.ui.search;
    entry.list.opts.onActivate = (item) => {
      const found = store.findSong(item.realId);
      if (found) actions.playSong(found.song.id);
      else actions.playItems([{ song: { ...item.song, id: item.realId }, playlistId: null }], item.realId);
    };
    entry.list.opts.onContextMenu = (item, selected, e, anchor) => {
      const found = store.findSong(item.realId);
      const real = found ? { song: found.song, playlistId: found.playlist.id } : { song: { ...item.song, id: item.realId }, playlistId: null };
      openSongMenu(real, [real], e, anchor, { playlistId: found ? found.playlist.id : null });
    };
    entry.list.opts.onRate = (item, v) => { const found = store.findSong(item.realId); if (found) actions.rateSong(found.song.id, v); };
    entry.list.setItems(currentItems);
    entry.list.setActive(null);
    const totalPlays = state.history.length;
    head.replaceChildren(
      h('div.view-head',
        h('div.view-head-main',
          h('div.view-kicker', '最近再生した曲'),
          h('h1.view-title', '再生履歴'),
          h('div.view-meta', `${totalPlays}件`, totalPlays ? ` · 最終 ${formatRelative(state.history[0].at)}` : '')
        ),
        h('div.view-actions',
          h('button.btn.btn-ghost.btn-round', { type: 'button', disabled: !totalPlays, onclick: async () => {
            if (await confirmDialog('再生履歴をすべて消去しますか？', { okLabel: '消去', danger: true })) { state.history = []; commit('history', 'ui'); }
          } }, icon('trash'), h('span.hide-sm', ' 履歴を消去'))
        )
      ),
      selBar
    );
    body.replaceChildren(entry.el);
  }

  // ===== キュー =====
  function renderQueue() {
    const e = ctx.engine;
    const entry = getList('queue', listOpts({ showIndex: true, showRemove: true, draggable: false,
      emptyContent: () => emptyState('次に再生する曲はありません', '曲のメニューから「次に再生」「キューに追加」で追加できます。プレイリストを再生すると続きの曲がここに並びます') }));
    const up = e ? e.upcoming(500) : [];
    const items = up.map((it, i) => ({ song: { ...it.song, id: `q${i}:${it.song.id}` }, realId: it.song.id, playlistId: it.playlistId, fromQueue: !!it.fromQueue, qIndex: it.fromQueue ? i : -1 }));
    currentItems = items;
    entry.list.opts.query = '';
    entry.list.opts.onActivate = (item) => {
      if (item.fromQueue) { const q = e.state.queue[item.qIndex]; e.removeFromQueue(item.qIndex); e.playItem(q); }
      else actions.playSong(item.realId);
    };
    entry.list.opts.onRemove = (item) => { if (item.fromQueue) e.removeFromQueue(item.qIndex); };
    entry.list.opts.onContextMenu = (item, selected, ev, anchor) => {
      const found = store.findSong(item.realId);
      const real = { song: found ? found.song : { ...item.song, id: item.realId }, playlistId: item.playlistId };
      openSongMenu(real, [real], ev, anchor, { playlistId: item.playlistId });
    };
    entry.list.opts.onRate = (item, v) => actions.rateSong(item.realId, v);
    entry.list.setItems(items);
    entry.list.setActive(null);
    const cur = e && e.state.song;
    head.replaceChildren(
      h('div.view-head',
        h('div.view-head-main',
          h('div.view-kicker', '再生待ち'),
          h('h1.view-title', 'キュー'),
          h('div.view-meta', cur ? h('span', '再生中: ', h('b', cur.title)) : '再生していません', e && e.state.queue.length ? ` · 「次に再生」${e.state.queue.length}曲` : '')
        ),
        h('div.view-actions',
          h('button.btn.btn-ghost.btn-round', { type: 'button', disabled: !(e && e.state.queue.length), onclick: () => e.clearQueue() }, icon('trash'), h('span.hide-sm', ' 次に再生をクリア'))
        )
      )
    );
    body.replaceChildren(entry.el);
  }

  // ===== バンク =====
  let bankLoading = false;
  async function renderBank() {
    head.replaceChildren(
      h('div.view-head',
        h('div.view-head-main',
          h('div.view-kicker', '同梱プリセット'),
          h('h1.view-title', 'プレイリストバンク'),
          h('div.view-meta', 'アプリに同梱されたプレイリスト集。読み込むと新しいプレイリストとして追加され、自作のリストとは別に管理されます')
        )
      )
    );
    if (!state.ui.bank.length && !bankLoading) {
      bankLoading = true;
      state.ui.bank = await listBankPresets();
      bankLoading = false;
      if (state.ui.view !== 'bank') return;
    }
    const grid = h('div.bank-grid');
    if (!state.ui.bank.length) grid.appendChild(emptyState('プリセットが見つかりません', 'playlists/samples/playlistbank.json を確認してください'));
    for (const p of state.ui.bank) {
      const loaded = store.playlists().filter(pl => pl.source === `bank:${p.id}`);
      const countEl = h('span.bank-count', '…');
      countBankCSV(p.file).then(n => { countEl.textContent = n == null ? '取得失敗' : `${n}曲`; });
      const card = h('div.bank-card',
        h('div.bank-icon', p.icon),
        h('div.bank-body',
          h('div.bank-name', p.name),
          h('div.bank-desc', p.description || ''),
          h('div.bank-meta', countEl, loaded.length ? h('span.chip.chip-ok', `読み込み済み${loaded.length > 1 ? ' ×' + loaded.length : ''}`) : null)
        ),
        h('div.bank-actions',
          h('button.btn.btn-primary.sm', { type: 'button', onclick: async (ev) => {
            const btn = ev.currentTarget; btn.disabled = true;
            try { await actions.loadBankPreset(p); } catch (err) { toastError('読み込みに失敗しました: ' + err.message); btn.disabled = false; }
          } }, icon('download'), ' 読み込む'),
          loaded.length ? h('button.btn.btn-ghost.sm', { type: 'button', onclick: () => { store.switchPlaylist(loaded[0].id); store.setView('playlist'); } }, '開く') : null
        )
      );
      grid.appendChild(card);
    }
    body.replaceChildren(grid);
  }

  // ===== 統計 =====
  function tile(label, value, sub) {
    return h('div.stat-tile', h('div.stat-label', label), h('div.stat-value', value), sub ? h('div.stat-sub', sub) : null);
  }

  // 単一系列の縦棒グラフ（凡例なし・タイトルが系列名）。各棒にホバーで値を表示
  function barChart(title, values, labelOf, { tickEvery = 1, unit = '回', empty = 'まだ再生履歴がありません' } = {}) {
    if (!values.some(v => v > 0)) return h('div.chart-card', h('div.chart-title', title), h('p.hint', empty));
    const max = Math.max(1, ...values);
    const tip = h('div.chart-tip');
    const bars = h('div.chart-bars', { role: 'img', 'aria-label': `${title}: ` + values.map((v, i) => `${labelOf(i)} ${v}${unit}`).join('、') });
    values.forEach((v, i) => {
      const bar = h('div.chart-col', { tabindex: 0 },
        h('div.chart-bar', { style: { height: v ? `max(3px, ${(v / max) * 100}%)` : '0' } }));
      const show = () => {
        tip.textContent = `${labelOf(i)}: ${v}${unit}`;
        tip.style.display = 'block';
        const r = bar.getBoundingClientRect(), pr = bars.getBoundingClientRect();
        tip.style.left = (r.left - pr.left + r.width / 2) + 'px';
        bar.classList.add('hover');
      };
      const hide = () => { tip.style.display = 'none'; bar.classList.remove('hover'); };
      bar.addEventListener('mouseenter', show); bar.addEventListener('focus', show);
      bar.addEventListener('mouseleave', hide); bar.addEventListener('blur', hide);
      bars.appendChild(bar);
    });
    const axis = h('div.chart-axis', ...values.map((_, i) => h('span', i % tickEvery === 0 ? labelOf(i) : '')));
    return h('div.chart-card', h('div.chart-title', title, h('span.chart-max', `最大 ${max}${unit}`)), h('div.chart-plot', bars, tip), axis);
  }

  function rankList(title, rows, empty) {
    return h('div.chart-card', h('div.chart-title', title),
      rows.length ? h('ol.rank', ...rows) : h('p.hint', empty));
  }

  function renderStats() {
    const st = computeStats(store.playlists(), state.history);
    head.replaceChildren(h('div.view-head', h('div.view-head-main',
      h('div.view-kicker', 'あなたの聴き方'), h('h1.view-title', '統計'),
      h('div.view-meta', 'このブラウザに保存されたプレイリストと再生履歴（最新300件）から集計しています'))));
    const now = new Date();
    const dayLabel = (i) => { const d = new Date(now); d.setDate(d.getDate() - (29 - i)); return `${d.getMonth() + 1}/${d.getDate()}`; };
    const maxPlays = Math.max(1, ...st.topSongs.map(s => s.playCount));
    const wrap = h('div.stats',
      h('div.stat-tiles',
        tile('曲', `${st.songCount}`, `${st.videoCount}本の動画 · ${st.playlistCount}プレイリスト`),
        tile('合計の長さ', formatDurationHuman(st.totalLength)),
        tile('再生回数', `${st.totalPlays}`, st.neverPlayed ? `未再生 ${st.neverPlayed}曲` : 'すべて再生済み'),
        tile('最近聴いた時間', formatDurationHuman(st.listened), `履歴 ${st.historyCount}件`),
        st.broken ? tile('リンク切れ', `${st.broken}`, '曲が再生できない可能性') : null
      ),
      h('div.stats-grid',
        barChart('日別の再生回数（30日）', st.daily, dayLabel, { tickEvery: 7 }),
        barChart('時間帯別の再生回数', st.hours, (i) => `${i}時`, { tickEvery: 3 }),
        rankList('よく聴く曲', st.topSongs.map(s => h('li.rank-row', { onclick: () => actions.playSong(s.id), title: '再生' },
          h('span.rank-name', s.title), h('span.rank-bar', h('i', { style: { width: (s.playCount / maxPlays * 100) + '%' } })), h('span.rank-val', `${s.playCount}回`))),
          'まだ再生履歴がありません'),
        rankList('歌い手 / チャンネル', st.topSingers.map(x => h('li.rank-row', { onclick: () => { state.ui.view = 'library'; state.ui.search = x.name; commit('ui'); }, title: 'ライブラリで表示' },
          h('span.rank-name', x.name), h('span.rank-val', `${x.count}曲 · ${x.plays}回`))),
          '曲の「歌い手 / チャンネル」が未入力です（URLから追加した曲は自動で入ります）'),
        rankList('アーティスト（原曲）', st.topArtists.map(x => h('li.rank-row', { onclick: () => { state.ui.view = 'library'; state.ui.search = x.name; commit('ui'); }, title: 'ライブラリで表示' },
          h('span.rank-name', x.name), h('span.rank-val', `${x.count}曲 · ${x.plays}回`))),
          'アーティストが未入力です（セットリスト貼り付けで「曲名 / アーティスト」形式なら自動で入ります）'),
        barChart('評価の分布', st.ratings, (i) => `★${i + 1}`, { unit: '曲', empty: '曲がありません' })
      )
    );
    body.replaceChildren(wrap);
  }

  function render() {
    const view = state.ui.view;
    const changed = view !== currentView;
    currentView = view;
    root.dataset.view = view;
    for (const k of Object.keys(lists)) lists[k].list.setRowHeight(rowHeight());
    if (view === 'playlist') renderPlaylist();
    else if (view === 'library') renderLibrary();
    else if (view === 'history') renderHistory();
    else if (view === 'queue') renderQueue();
    else if (view === 'bank') renderBank();
    else if (view === 'stats') renderStats();
    if (changed) body.scrollTop = 0;
  }

  store.on('data', render);
  store.on('ui', render);
  store.on('settings', render);
  store.on('history', () => { if (currentView === 'history' || currentView === 'stats') render(); });
  if (ctx.engine) {
    ctx.engine.on('change', () => {
      const entry = lists[currentView];
      if (entry && (currentView === 'playlist' || currentView === 'library')) {
        entry.list.setActive(ctx.engine.state.song ? ctx.engine.state.song.id : null);
      }
      if (currentView === 'queue') render();
    });
  }
  render();

  return {
    focusList: () => { const entry = lists[currentView]; if (entry) entry.list.c.focus(); },
    currentList: () => lists[currentView] ? lists[currentView].list : null,
    currentItems: () => currentItems,
    scrollToPlaying: () => {
      const entry = lists[currentView];
      if (entry && ctx.engine && ctx.engine.state.song) entry.list.scrollToId(ctx.engine.state.song.id);
    }
  };
}
