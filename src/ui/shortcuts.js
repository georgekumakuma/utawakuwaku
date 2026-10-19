// グローバルキーボードショートカット

import { isTypingTarget } from './dom.js';
import { state } from '../core/store.js';
import * as store from '../core/store.js';
import * as actions from '../app/actions.js';
import { ctx } from '../app/context.js';
import { closeTopModal, hasOpenModal } from './dialog.js';
import { closeMenu } from './menu.js';
import { openPalette } from './palette.js';
import { openHelp } from './help.js';
import { openAddModal } from './addmodal.js';
import { closeDrawer } from './sidebar.js';

export function installShortcuts({ focusSearch, views, editor }) {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const typing = isTypingTarget(document.activeElement);

    // どこでも効くもの
    if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); return; }
    if (e.key === 'Escape') {
      if (closeTopModal()) { e.preventDefault(); return; }
      closeMenu();
      if (document.body.classList.contains('drawer-open')) { closeDrawer(); return; }
      if (typing) { document.activeElement.blur(); return; }
      if (state.ui.editorOpen) { actions.closeEditor(); return; }
      return;
    }
    if (hasOpenModal()) return;
    if (mod && e.key === 'Enter' && editor.isOpen()) { e.preventDefault(); editor.save(); return; }
    if (typing) return;
    if (e.altKey) return;

    const inList = document.activeElement && document.activeElement.classList.contains('songlist');
    const e2 = ctx.engine;

    switch (e.key) {
      case ' ': e.preventDefault(); actions.togglePlay(); return;
      case 'ArrowRight': e.preventDefault(); if (e.shiftKey) e2 && e2.seekBy(10); else actions.next(); return;
      case 'ArrowLeft': e.preventDefault(); if (e.shiftKey) e2 && e2.seekBy(-10); else actions.prev(); return;
      case 'ArrowUp': if (!inList) { e.preventDefault(); e2 && actions.setVolume(Math.min(100, e2.state.volume + 5)); } return;
      case 'ArrowDown': if (!inList) { e.preventDefault(); e2 && actions.setVolume(Math.max(0, e2.state.volume - 5)); } return;
      case '/': e.preventDefault(); focusSearch(); return;
      case '?': e.preventDefault(); openHelp(); return;
      default: break;
    }
    if (mod) return;
    switch (e.key.toLowerCase()) {
      case 's': actions.toggleShuffle(); break;
      case 'r': actions.cycleRepeat(); break;
      case 'm': actions.toggleMute(); break;
      case 'v': store.setSetting('showVideo', !state.settings.showVideo); break;
      case 'q': actions.togglePanel('queue'); break;
      case 'a': openAddModal(); break;
      case 'l': views.scrollToPlaying(); break;
      case 'i': if (editor.isOpen()) editor.markStart(); break;
      case 'o': if (editor.isOpen()) editor.markEnd(); break;
      case 'e': {
        const list = views.currentList();
        const sel = list ? list.selectedItems() : [];
        const id = sel.length === 1 ? (sel[0].realId || sel[0].song.id) : (e2 && e2.state.song && !e2.state.song._draft ? e2.state.song.id : null);
        if (id && store.findSong(id)) actions.openEditor(id);
        break;
      }
      case 'n': {
        const list = views.currentList();
        const sel = list ? list.selectedItems() : [];
        if (sel.length) actions.enqueue(sel.map(it => ({ song: store.findSong(it.realId || it.song.id)?.song || it.song, playlistId: it.playlistId })), { next: true });
        break;
      }
      case 'delete': case 'backspace': {
        if (state.ui.view !== 'playlist') break;
        const list = views.currentList();
        const sel = list ? list.selectedItems() : [];
        if (sel.length) { e.preventDefault(); actions.deleteSongs(state.data.currentId, sel.map(it => it.song.id)); }
        break;
      }
      default: break;
    }
  });
}
