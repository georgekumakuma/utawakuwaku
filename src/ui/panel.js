// 右パネル（編集 / キュー）の切り替え

import { h, icon } from './dom.js';
import { state } from '../core/store.js';
import * as store from '../core/store.js';
import * as actions from '../app/actions.js';
import { ctx } from '../app/context.js';
import { mountEditor } from './editor.js';
import { SongList } from './songlist.js';
import { openSongMenu } from '../app/songmenu.js';

export function mountPanel(root) {
  const editorEl = h('div.panel-view.panel-editor');
  const queueEl = h('div.panel-view.panel-queue');
  root.append(editorEl, queueEl);
  const editor = mountEditor(editorEl);

  // ----- キュー -----
  const qCount = h('span.panel-sub');
  const qListEl = h('div.panel-list');
  const qList = new SongList(qListEl, {
    rowHeight: 48, showIndex: true, showRemove: true, showRange: false, showRating: false,
    emptyContent: () => h('div.panel-empty', '次に再生する曲はありません'),
    onActivate: (item) => {
      const e = ctx.engine;
      if (item.fromQueue) { const q = e.state.queue[item.qIndex]; e.removeFromQueue(item.qIndex); e.playItem(q); }
      else actions.playSong(item.realId);
    },
    onRemove: (item) => { if (item.fromQueue) ctx.engine.removeFromQueue(item.qIndex); },
    onContextMenu: (item, selected, ev, anchor) => {
      const found = store.findSong(item.realId);
      const real = { song: found ? found.song : { ...item.song, id: item.realId }, playlistId: item.playlistId };
      openSongMenu(real, [real], ev, anchor, { playlistId: item.playlistId });
    }
  });
  queueEl.append(
    h('div.panel-head', h('h3.panel-title', 'キュー'), qCount,
      h('button.icon-btn.sm', { type: 'button', title: '「次に再生」をクリア', onclick: () => ctx.engine && ctx.engine.clearQueue() }, icon('trash')),
      h('button.icon-btn', { type: 'button', title: '閉じる', onclick: () => actions.closeEditor() }, icon('close'))),
    qListEl
  );

  function renderQueue() {
    const e = ctx.engine;
    if (!e) return;
    const up = e.upcoming(300);
    const items = up.map((it, i) => ({ song: { ...it.song, id: `pq${i}:${it.song.id}` }, realId: it.song.id, playlistId: it.playlistId, fromQueue: !!it.fromQueue, qIndex: it.fromQueue ? i : -1 }));
    qList.setItems(items);
    qCount.textContent = e.state.queue.length ? `次に再生 ${e.state.queue.length}曲 · 続き ${up.length - e.state.queue.length}曲` : `続き ${up.length}曲`;
  }

  function render() {
    const open = state.ui.editorOpen;
    document.body.classList.toggle('panel-open', open);
    editorEl.style.display = open && state.ui.panel === 'editor' ? '' : 'none';
    queueEl.style.display = open && state.ui.panel === 'queue' ? '' : 'none';
    if (open && state.ui.panel === 'queue') renderQueue();
  }

  store.on('ui', render);
  if (ctx.engine) ctx.engine.on('change', () => { if (state.ui.editorOpen && state.ui.panel === 'queue') renderQueue(); });
  render();
  return editor;
}
