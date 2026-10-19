// サイドバー: ナビゲーション＋プレイリスト一覧

import { h, icon } from './dom.js';
import * as store from '../core/store.js';
import { state, commit } from '../core/store.js';
import * as actions from '../app/actions.js';
import { ctx } from '../app/context.js';
import { showMenu } from './menu.js';
import { openAddModal } from './addmodal.js';
import { openSettings } from './settings.js';
import { openHelp } from './help.js';

export function mountSidebar(root) {
  const nav = h('nav.side-nav');
  const plList = h('ul.side-playlists', { role: 'list' });
  root.append(
    h('div.brand', h('span.brand-mark', '♪'), h('span.brand-name', 'utawakuwaku'), h('span.brand-ver', 'v2')),
    h('button.btn.btn-primary.btn-block.side-add', { type: 'button', onclick: () => openAddModal() }, icon('plus'), ' 曲・リストを追加'),
    nav,
    h('div.side-section-head', h('span', 'プレイリスト'),
      h('button.icon-btn.sm', { type: 'button', title: '新しいプレイリスト', onclick: () => actions.createPlaylistDialog() }, icon('plus'))),
    plList,
    h('div.side-footer',
      h('button.side-link', { type: 'button', onclick: () => openSettings() }, icon('settings'), ' 設定'),
      h('button.side-link', { type: 'button', onclick: () => openHelp() }, icon('keyboard'), ' ショートカット')
    )
  );

  function navItem(view, label, ic, count) {
    const active = state.ui.view === view;
    return h('button.side-item', {
      type: 'button', class: active ? 'active' : '', 'aria-current': active ? 'page' : null,
      onclick: () => { store.setView(view); closeDrawer(); }
    }, icon(ic), h('span.side-label', label), count != null ? h('span.side-count', String(count)) : null);
  }

  function render() {
    const e = ctx.engine;
    const queueCount = e ? e.state.queue.length : 0;
    const libCount = store.librarySongs().length;
    nav.replaceChildren(
      navItem('library', 'ライブラリ', 'library', libCount),
      navItem('history', '再生履歴', 'history'),
      navItem('queue', 'キュー', 'queue', queueCount || null),
      navItem('bank', 'バンク（共有・サンプル）', 'bank'),
      navItem('stats', '統計', 'star')
    );
    plList.replaceChildren(...store.playlists().map(pl => {
      const active = state.ui.view === 'playlist' && pl.id === state.data.currentId;
      const playing = e && e.state.playlistId === pl.id && e.state.status === 'playing';
      const li = h('li.side-pl', { class: `${active ? 'active' : ''} ${playing ? 'playing' : ''}`, dataset: { id: pl.id }, draggable: true },
        h('span.side-pl-icon', pl.icon || '♪'),
        h('span.side-pl-name', { title: pl.name }, pl.name),
        h('span.side-count', String(pl.songs.length)),
        h('button.icon-btn.sm.side-pl-more', { type: 'button', title: 'メニュー', onclick: (ev) => { ev.stopPropagation(); playlistMenu(pl, ev.currentTarget); } }, icon('more'))
      );
      li.addEventListener('click', () => {
        if (pl.id !== state.data.currentId) store.switchPlaylist(pl.id);
        if (state.ui.view !== 'playlist') store.setView('playlist');
        closeDrawer();
      });
      li.addEventListener('contextmenu', (ev) => { ev.preventDefault(); playlistMenu(pl, null, ev); });
      li.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', pl.id); ev.dataTransfer.effectAllowed = 'move'; li.classList.add('dragging'); });
      li.addEventListener('dragend', () => li.classList.remove('dragging'));
      li.addEventListener('dragover', (ev) => { ev.preventDefault(); li.classList.add('drag-over'); });
      li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
      li.addEventListener('drop', (ev) => {
        ev.preventDefault();
        li.classList.remove('drag-over');
        const id = ev.dataTransfer.getData('text/plain');
        if (id && id !== pl.id) store.movePlaylist(id, store.playlists().indexOf(pl));
      });
      return li;
    }));
  }

  function playlistMenu(pl, anchor, ev) {
    showMenu([
      { label: '再生', icon: 'play', onClick: () => actions.playPlaylist(pl.id, { shuffle: false }) },
      { label: 'シャッフル再生', icon: 'shuffle', onClick: () => actions.playPlaylist(pl.id, { shuffle: true }) },
      'sep',
      { label: '名前を変更', icon: 'edit', onClick: () => actions.renamePlaylistDialog(pl.id) },
      { label: 'アイコンを変更', icon: 'sparkle', onClick: () => pickIcon(pl) },
      { label: '複製', icon: 'layers', onClick: () => actions.duplicatePlaylist(pl.id) },
      'sep',
      { label: '共有URLをコピー', icon: 'share', onClick: () => actions.sharePlaylist(pl.id) },
      { label: 'CSVを書き出し', icon: 'download', onClick: () => actions.exportCSV(pl.id) },
      { label: 'セットリストをコピー', icon: 'text', onClick: () => actions.copySetlist(pl.id) },
      'sep',
      { label: '削除', icon: 'trash', danger: true, onClick: () => actions.deletePlaylistDialog(pl.id) }
    ], anchor ? { anchor } : { x: ev.clientX, y: ev.clientY });
  }

  function pickIcon(pl) {
    const icons = ['⭐', '🎵', '🎤', '🎧', '💕', '🔥', '🌙', '🌸', '🐱', '🐰', '🦋', '🍀', '📱', '🎹', '🎸', '🥁', '🎻', '🍵', '🌈', '💎', '👑', '🎀', '🧸', '🍰'];
    showMenu(icons.map(ic => ({ label: ic, onClick: () => { pl.icon = ic; commit('data'); } })), { anchor: root.querySelector(`.side-pl[data-id="${pl.id}"]`) });
  }

  store.on('data', render);
  store.on('ui', render);
  if (ctx.engine) ctx.engine.on('change', render);
  render();
}

export function openDrawer() { document.body.classList.add('drawer-open'); }
export function closeDrawer() { document.body.classList.remove('drawer-open'); }
export function toggleDrawer() { document.body.classList.toggle('drawer-open'); }
