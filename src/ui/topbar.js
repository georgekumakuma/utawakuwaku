// 上部バー: 検索・追加・コマンドパレット・設定

import { h, icon, debounce } from './dom.js';
import { state, commit } from '../core/store.js';
import * as store from '../core/store.js';
import { toggleDrawer } from './sidebar.js';
import { openAddModal } from './addmodal.js';
import { openPalette } from './palette.js';
import { openSettings } from './settings.js';
import { modKey } from '../app/context.js';

export function mountTopbar(root) {
  const input = h('input.search-input', { type: 'search', placeholder: '曲名・アーティスト・配信名・タグで検索  ( / )', 'aria-label': '検索', autocomplete: 'off' });
  const clearBtn = h('button.icon-btn.sm.search-clear', { type: 'button', title: 'クリア', style: { display: 'none' } }, icon('close'));
  const push = debounce(() => { state.ui.search = input.value; commit('ui'); }, 120);
  input.addEventListener('input', () => { clearBtn.style.display = input.value ? '' : 'none'; push(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; clearBtn.style.display = 'none'; state.ui.search = ''; commit('ui'); input.blur(); }
    if (e.key === 'Enter') { e.preventDefault(); const list = document.querySelector('.songlist'); if (list) list.focus(); }
  });
  clearBtn.addEventListener('click', () => { input.value = ''; clearBtn.style.display = 'none'; state.ui.search = ''; commit('ui'); input.focus(); });

  root.append(
    h('button.icon-btn.menu-toggle', { type: 'button', 'aria-label': 'メニュー', onclick: () => toggleDrawer() }, icon('menu')),
    h('div.topbar-brand', h('span.brand-mark', '♪'), ' utawakuwaku'),
    h('div.search', icon('search', 'search-ic'), input, clearBtn),
    h('div.topbar-actions',
      h('button.btn.btn-primary.topbar-add', { type: 'button', onclick: () => openAddModal() }, icon('plus'), h('span.hide-sm', ' 追加')),
      h('button.icon-btn', { type: 'button', title: `コマンドパレット (${modKey()}+K)`, onclick: () => openPalette() }, icon('sparkle')),
      h('button.icon-btn', { type: 'button', title: '設定', onclick: () => openSettings() }, icon('settings'))
    )
  );

  // ビュー切替で検索をリセットしたときに入力欄へ反映
  store.on('ui', () => {
    if (input.value !== state.ui.search && document.activeElement !== input) {
      input.value = state.ui.search;
      clearBtn.style.display = input.value ? '' : 'none';
    }
  });

  return { focusSearch: () => { input.focus(); input.select(); } };
}
