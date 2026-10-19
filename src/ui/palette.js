// コマンドパレット（Ctrl+K / ⌘K）: 曲の横断検索とコマンド実行

import { h, icon, highlightInto } from './dom.js';
import { state } from '../core/store.js';
import * as store from '../core/store.js';
import * as actions from '../app/actions.js';
import { ctx } from '../app/context.js';
import { openAddModal } from './addmodal.js';
import { openSettings } from './settings.js';
import { openHelp } from './help.js';
import { formatTime } from '../core/time.js';

let open = null;

function commands() {
  const e = ctx.engine;
  const cur = store.currentPlaylist();
  return [
    { label: '曲を追加（URLから）', icon: 'video', run: () => openAddModal('url'), kw: 'add url 追加' },
    { label: 'セットリストを貼り付けて取り込む', icon: 'text', run: () => openAddModal('setlist'), kw: 'setlist timestamps タイムスタンプ' },
    { label: 'CSV / バックアップを読み込む', icon: 'upload', run: () => openAddModal('file'), kw: 'import csv json' },
    { label: '新しいプレイリストを作成', icon: 'plus', run: () => actions.createPlaylistDialog(), kw: 'new playlist' },
    'sep',
    { label: e && (e.state.status === 'playing') ? '一時停止' : '再生', icon: 'play', run: () => actions.togglePlay(), hint: 'Space' },
    { label: '次の曲', icon: 'next', run: () => actions.next(), hint: '→' },
    { label: '前の曲', icon: 'prev', run: () => actions.prev(), hint: '←' },
    { label: `シャッフル ${e && e.state.shuffle ? 'OFF' : 'ON'}`, icon: 'shuffle', run: () => actions.toggleShuffle(), hint: 'S' },
    { label: 'リピートを切り替え', icon: 'repeat', run: () => actions.cycleRepeat(), hint: 'R' },
    { label: `映像を${state.settings.showVideo ? '隠す' : '表示'}`, icon: 'video', run: () => store.setSetting('showVideo', !state.settings.showVideo), hint: 'V' },
    'sep',
    cur ? { label: `「${cur.name}」をシャッフル再生`, icon: 'shuffle', run: () => actions.playPlaylist(cur.id, { shuffle: true }) } : null,
    cur ? { label: `「${cur.name}」の共有URLをコピー`, icon: 'share', run: () => actions.sharePlaylist(cur.id) } : null,
    cur ? { label: `「${cur.name}」をCSVで書き出し`, icon: 'download', run: () => actions.exportCSV(cur.id) } : null,
    cur ? { label: `「${cur.name}」のセットリストをコピー`, icon: 'text', run: () => actions.copySetlist(cur.id) } : null,
    { label: 'すべてをJSONでバックアップ', icon: 'download', run: () => actions.exportAllJSON() },
    'sep',
    { label: 'ライブラリを開く', icon: 'library', run: () => store.setView('library') },
    { label: '再生履歴を開く', icon: 'history', run: () => store.setView('history') },
    { label: 'キューを開く', icon: 'queue', run: () => store.setView('queue') },
    { label: 'プレイリストバンクを開く', icon: 'bank', run: () => store.setView('bank') },
    ...store.playlists().map(p => ({ label: `プレイリスト「${p.name}」を開く`, icon: 'list', run: () => { store.switchPlaylist(p.id); store.setView('playlist'); }, kw: p.name })),
    'sep',
    { label: '設定', icon: 'settings', run: () => openSettings() },
    { label: 'キーボードショートカット', icon: 'keyboard', run: () => openHelp(), hint: '?' }
  ].filter(Boolean);
}

function score(text, q) {
  const t = text.toLowerCase();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  let s = 0;
  for (const term of terms) {
    const i = t.indexOf(term);
    if (i < 0) return -1;
    s += (i === 0 ? 3 : 1) + term.length;
  }
  return s;
}

export function openPalette() {
  if (open) { open.close(); return; }
  const input = h('input.palette-input', { type: 'text', placeholder: '曲名・アーティスト・コマンドを入力…', autocomplete: 'off', spellcheck: false });
  const list = h('div.palette-list', { role: 'listbox' });
  const overlay = h('div.palette-overlay', h('div.palette', h('div.palette-head', icon('search'), input, h('kbd', 'Esc')), list));
  let results = [];
  let sel = 0;

  function close() {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 150);
    document.removeEventListener('keydown', onKey, true);
    open = null;
  }

  function build() {
    const q = input.value.trim();
    results = [];
    if (!q) {
      for (const c of commands()) if (c !== 'sep') results.push({ type: 'cmd', ...c });
      results = results.slice(0, 14);
    } else {
      const cmds = commands().filter(c => c !== 'sep').map(c => ({ type: 'cmd', s: score(`${c.label} ${c.kw || ''}`, q), ...c })).filter(c => c.s >= 0);
      const songs = store.librarySongs().map(({ song, playlists }) => ({ type: 'song', song, playlists, s: score(`${song.title} ${song.artist} ${song.article} ${song.singer} ${(song.tags || []).join(' ')}`, q) }))
        .filter(x => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 30);
      results = [...cmds.sort((a, b) => b.s - a.s).slice(0, 6), ...songs];
    }
    sel = 0;
    render();
  }

  function render() {
    const q = input.value.trim();
    list.replaceChildren(...results.map((r, i) => {
      const el = h('div.palette-item', { class: `${r.type} ${i === sel ? 'sel' : ''}`, role: 'option', onclick: () => run(i), onmousemove: () => { if (sel !== i) { sel = i; render(); } } });
      if (r.type === 'cmd') {
        el.append(h('span.pi-ic', icon(r.icon || 'sparkle')), h('span.pi-label', r.label), r.hint ? h('kbd', r.hint) : null);
      } else {
        const t = h('span.pi-label'); highlightInto(t, r.song.title, q);
        const sub = h('span.pi-sub'); highlightInto(sub, [r.song.artist, r.song.article].filter(Boolean).join(' · '), q);
        el.append(h('img.pi-thumb', { src: `https://i.ytimg.com/vi/${r.song.videoId}/default.jpg`, alt: '' }), h('span.pi-text', t, sub),
          h('span.pi-meta', formatTime(r.song.start), r.playlists.length ? h('span.chip.sm', r.playlists[0].name) : null));
      }
      return el;
    }));
    if (!results.length) list.appendChild(h('div.palette-empty', '該当なし'));
    const selEl = list.children[sel];
    if (selEl && selEl.scrollIntoView) selEl.scrollIntoView({ block: 'nearest' });
  }

  function run(i) {
    const r = results[i];
    if (!r) return;
    close();
    if (r.type === 'cmd') r.run();
    else {
      const found = store.findSong(r.song.id);
      if (found) actions.playSong(found.song.id);
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
  }

  input.addEventListener('input', build);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  setTimeout(() => input.focus(), 30);
  build();
  open = { close };
}
