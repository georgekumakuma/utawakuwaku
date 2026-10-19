// 「追加」モーダル: URL / セットリスト貼り付け / ファイル・CSVテキスト

import { h, icon, debounce } from './dom.js';
import { openModal } from './dialog.js';
import { state } from '../core/store.js';
import * as store from '../core/store.js';
import * as actions from '../app/actions.js';
import { ctx } from '../app/context.js';
import { parseYouTubeInput, isValidVideoId, thumbUrl } from '../core/ytid.js';
import { parseSetlist } from '../core/setlist.js';
import { csvToSongs } from '../core/csv.js';
import { formatTime } from '../core/time.js';
import { normalizeSong } from '../core/model.js';
import { fetchVideoInfo } from '../player/yt.js';
import { toast, toastError } from './toast.js';

const SETLIST_SAMPLE = `例（YouTubeのコメント・概要欄からそのまま貼り付け）:
0:12 ドライフラワー / 優里
4:30 夜に駆ける / YOASOBI
9:01 ～ 12:40 残酷な天使のテーゼ
1:00:05 アンコール`;

export function openAddModal(initialTab = 'url') {
  let tab = initialTab;
  const tabs = h('div.tabs');
  const body = h('div.add-body');
  const content = h('div', tabs, body);
  const modal = openModal({ title: '曲・プレイリストを追加', content, size: 'lg', className: 'add-modal' });

  function renderTabs() {
    tabs.replaceChildren(
      ...[['url', 'video', 'URLから'], ['setlist', 'text', 'セットリスト貼り付け'], ['file', 'upload', 'CSV / バックアップ']].map(([k, ic, label]) =>
        h('button.tab', { type: 'button', class: tab === k ? 'on' : '', onclick: () => { tab = k; renderTabs(); renderBody(); } }, icon(ic), ' ', label))
    );
  }

  // ----- 動画プレビュー（URL / セットリスト共通） -----
  function videoPreview(onChange) {
    const input = h('input.input', { type: 'text', placeholder: 'https://www.youtube.com/watch?v=... または 動画ID', autocomplete: 'off' });
    const box = h('div.video-preview');
    let current = null;
    const update = debounce(async () => {
      const p = parseYouTubeInput(input.value);
      if (!p) { box.replaceChildren(input.value.trim() ? h('div.form-error', 'YouTubeのURLまたは11文字の動画IDを入力してください') : null); current = null; onChange(null); return; }
      current = { videoId: p.videoId, start: p.start, title: '', author: '' };
      box.replaceChildren(h('img', { src: thumbUrl(p.videoId, 'mqdefault'), alt: '', onerror: (e) => { e.target.style.visibility = 'hidden'; } }), h('div.video-preview-text', h('div.vp-title', '動画情報を取得中…'), h('div.vp-author', p.videoId)));
      onChange(current);
      try {
        const info = await fetchVideoInfo(p.videoId);
        if (!current || current.videoId !== p.videoId) return;
        current.title = info.title; current.author = info.author;
        box.querySelector('.vp-title').textContent = info.title;
        box.querySelector('.vp-author').textContent = info.author;
        onChange(current);
      } catch {
        if (current && current.videoId === p.videoId) box.querySelector('.vp-title').textContent = '（動画情報を取得できませんでした）';
      }
    }, 200);
    input.addEventListener('input', update);
    input.addEventListener('paste', () => setTimeout(update, 0));
    setTimeout(() => input.focus(), 50);
    return { el: h('div.field', h('label', 'YouTube の URL / 動画ID'), input, box), input, get: () => current };
  }

  // ===== URL タブ =====
  function renderUrl() {
    let v = null;
    const btnEdit = h('button.btn.btn-primary', { type: 'button', disabled: true, onclick: () => {
      if (!v) return;
      modal.close();
      actions.openEditor(null, { videoId: v.videoId, start: v.start || 0, end: 0, article: v.title, singer: v.author });
      if (ctx.engine && ctx.engine.ready) ctx.engine.loadForEdit({ videoId: v.videoId, start: v.start || 0, end: 0, title: '', article: v.title, rating: 3, _draft: true }, { autoplay: true });
    } }, icon('scissors'), ' プレイヤーで区間を決める');
    const btnWhole = h('button.btn.btn-ghost', { type: 'button', disabled: true, onclick: () => {
      if (!v) return;
      const song = normalizeSong({ videoId: v.videoId, title: v.title || v.videoId, start: v.start || 0, end: 0, rating: 3, article: v.title, singer: v.author });
      actions.importSongs([song], { mode: 'current' });
      modal.close();
    } }, icon('plus'), ' 動画をまるごと追加');
    const pv = videoPreview((cur) => { v = cur; btnEdit.disabled = !cur; btnWhole.disabled = !cur; });
    body.replaceChildren(
      pv.el,
      h('p.hint', 'URLに「&t=」が付いていれば、その位置が開始位置になります。区間は次の画面でプレイヤーを見ながら I / O キー（開始 / 終了）で決められます。'),
      h('div.btn-row', btnEdit, btnWhole)
    );
    pv.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && v) { e.preventDefault(); btnEdit.click(); } });
  }

  // ===== セットリスト タブ =====
  function renderSetlist() {
    let v = null;
    let parsed = [];
    const ta = h('textarea.input.setlist-ta', { rows: 8, placeholder: SETLIST_SAMPLE, spellcheck: false });
    const gap = h('input.input.xs', { type: 'number', min: 0, max: 30, step: 1, value: 0, title: '次の曲の開始から何秒前で終わるか' });
    const preview = h('div.setlist-preview');
    const summary = h('span.setlist-summary');
    const btnCurrent = h('button.btn.btn-ghost', { type: 'button', disabled: true, onclick: () => doImport('current') }, icon('plus'), ' 現在のリストに追加');
    const btnNew = h('button.btn.btn-primary', { type: 'button', disabled: true, onclick: () => doImport('new') }, icon('library'), ' 新しいプレイリストにする');
    const pv = videoPreview((cur) => { v = cur; reparse(); });

    function reparse() {
      parsed = parseSetlist(ta.value, { gap: parseFloat(gap.value) || 0 });
      preview.replaceChildren();
      if (!parsed.length) {
        summary.textContent = ta.value.trim() ? 'タイムスタンプ（例 1:23 や 1:02:03）が見つかりません' : '';
        btnCurrent.disabled = btnNew.disabled = true;
        return;
      }
      const table = h('table.setlist-table',
        h('thead', h('tr', h('th', ''), h('th', '開始'), h('th', '終了'), h('th', '曲名'), h('th', 'アーティスト'))),
        h('tbody', ...parsed.map((it, i) => {
          it.use = true;
          const cb = h('input', { type: 'checkbox', checked: true, onchange: (e) => { it.use = e.target.checked; updateSummary(); } });
          const t = h('input.input.xs', { type: 'text', value: it.title, oninput: (e) => { it.title = e.target.value; } });
          const a = h('input.input.xs', { type: 'text', value: it.artist, oninput: (e) => { it.artist = e.target.value; } });
          return h('tr', h('td', cb), h('td.mono', formatTime(it.start)), h('td.mono', it.end ? formatTime(it.end) : '最後'), h('td', t), h('td', a));
        }))
      );
      preview.appendChild(table);
      updateSummary();
    }
    function updateSummary() {
      const n = parsed.filter(it => it.use).length;
      summary.textContent = `${n}曲を取り込みます`;
      btnCurrent.disabled = btnNew.disabled = !(n && v);
      if (!v && n) summary.textContent += '（動画のURLも入力してください）';
    }
    function doImport(mode) {
      if (!v) return;
      const songs = parsed.filter(it => it.use).map(it => normalizeSong({
        videoId: v.videoId, title: it.title, artist: it.artist, start: it.start, end: it.end, rating: 3, article: v.title, singer: v.author
      }));
      try {
        actions.importSongs(songs, { mode, name: v.title || 'セットリスト' });
        modal.close();
      } catch (e) { toastError(e.message); }
    }
    ta.addEventListener('input', debounce(reparse, 150));
    gap.addEventListener('change', reparse);
    body.replaceChildren(
      pv.el,
      h('div.field', h('label', 'セットリスト（タイムスタンプ付きテキスト）'), ta),
      h('div.field-row.setlist-opts', h('label', '曲の終わりを次の曲の '), gap, h('span', ' 秒前にする'), summary),
      preview,
      h('div.btn-row', btnNew, btnCurrent)
    );
  }

  // ===== ファイル タブ =====
  function renderFile() {
    const fileInput = h('input', { type: 'file', accept: '.csv,.json,.txt,text/csv,application/json', style: { display: 'none' } });
    const drop = h('div.dropzone', { tabindex: 0 }, icon('upload', 'dz-ic'), h('div', 'CSV または JSONバックアップをここにドロップ'), h('div.hint', 'またはクリックして選択（旧バージョンのCSVもそのまま読めます）'));
    drop.addEventListener('click', () => fileInput.click());
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', async (e) => {
      e.preventDefault(); drop.classList.remove('over');
      for (const f of Array.from(e.dataTransfer.files)) await handle(f);
    });
    fileInput.addEventListener('change', async () => { for (const f of Array.from(fileInput.files)) await handle(f); fileInput.value = ''; });
    async function handle(f) {
      try { await actions.importFile(f); modal.close(); } catch (err) { toastError(`${f.name}: ${err.message}`); }
    }
    const ta = h('textarea.input', { rows: 6, placeholder: 'videoId,title,start,end,rating,article\nuvNqgBWckp4,曲名,861,1096,5,配信タイトル', spellcheck: false });
    const count = h('span.hint');
    const btnNew = h('button.btn.btn-primary', { type: 'button', disabled: true, onclick: () => importText('new') }, icon('library'), ' 新しいプレイリストにする');
    const btnCur = h('button.btn.btn-ghost', { type: 'button', disabled: true, onclick: () => importText('current') }, icon('plus'), ' 現在のリストに追加');
    ta.addEventListener('input', debounce(() => {
      const n = csvToSongs(ta.value).length;
      count.textContent = n ? `${n}曲を認識` : (ta.value.trim() ? '認識できる行がありません' : '');
      btnNew.disabled = btnCur.disabled = !n;
    }, 150));
    function importText(mode) {
      try { actions.importCSVText(ta.value, { mode, name: `貼り付け ${new Date().toLocaleDateString('ja-JP')}` }); modal.close(); }
      catch (e) { toastError(e.message); }
    }
    body.replaceChildren(
      drop, fileInput,
      h('div.or', 'または CSV テキストを貼り付け'),
      h('div.field', ta, count),
      h('div.btn-row', btnNew, btnCur)
    );
  }

  function renderBody() {
    if (tab === 'url') renderUrl();
    else if (tab === 'setlist') renderSetlist();
    else renderFile();
  }
  renderTabs();
  renderBody();
  void toast; void store; void state;
  return modal;
}
