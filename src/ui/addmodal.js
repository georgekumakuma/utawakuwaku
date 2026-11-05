// 「追加」モーダル: URL / セットリスト貼り付け / ファイル・CSVテキスト

import { h, icon, debounce, fill } from './dom.js';
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
import { estimateEnd } from '../core/tracklen.js';
import { lookupMany } from '../app/tracklookup.js';
import { estimateBadge, TRIM_NOTE } from './trim.js';
import { toast, toastError } from './toast.js';

const SETLIST_SAMPLE = `例（YouTubeのコメント・概要欄からそのまま貼り付け）:
0:12 ドライフラワー / 優里
4:30 夜に駆ける / YOASOBI
9:01 ～ 12:40 残酷な天使のテーゼ
1:00:05 アンコール`;

// prefill: { url, text } — 貼り付け・ドロップから開いたときの初期値
export function openAddModal(initialTab = 'url', prefill = {}) {
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
      if (!p) { fill(box, input.value.trim() ? h('div.form-error', 'YouTubeのURLまたは11文字の動画IDを入力してください') : null); current = null; onChange(null); return; }
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
    if (prefill.url) { pv.input.value = prefill.url; pv.input.dispatchEvent(new Event('input')); }
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
    const pv = videoPreview((cur) => { v = cur; if (parsed.length) updateSummary(); });

    // 曲間カット（原曲の長さで終わりを推定）
    const trimCb = h('input', { type: 'checkbox', checked: state.settings.trimGaps });
    const tailIn = h('input.input.xs', { type: 'number', min: 0, max: 20, step: 1, value: state.settings.trimTail, title: '原曲の長さに足す余韻（秒）' });
    const trimStatus = h('span.trim-status');
    let trimToken = 0;
    const rowRefs = [];
    function applyEstimate(i) {
      const it = parsed[i]; const ref = rowRefs[i];
      if (!it || !ref) return;
      it.est = (state.settings.trimGaps && it.info && it.info.seconds)
        ? estimateEnd({ start: it.start, end: it.end || 0, duration: it.info.seconds, tail: state.settings.trimTail })
        : null;
      const end = it.est ? it.est.end : it.end;
      ref.end.textContent = end ? formatTime(end) : '最後';
      ref.end.classList.toggle('trimmed', !!it.est);
      ref.est.replaceChildren(state.settings.trimGaps ? estimateBadge(it.info, it.est) : '');
    }
    function trimSummary() {
      if (!state.settings.trimGaps) { trimStatus.textContent = ''; return; }
      const done = parsed.filter(it => it.info).length;
      if (done < parsed.length) { trimStatus.textContent = `原曲の長さを調べています ${done} / ${parsed.length}`; return; }
      const est = parsed.filter(it => it.est);
      const cut = est.reduce((a, it) => a + (it.est.cut || 0), 0);
      trimStatus.textContent = `${est.length}曲の終わりを推定${cut ? `（合計 ${formatTime(cut)} カット）` : ''}`;
    }
    function runTrim() {
      const token = ++trimToken;
      parsed.forEach((_, i) => applyEstimate(i));
      trimSummary();
      if (!state.settings.trimGaps || !parsed.length) return;
      const targets = parsed.map(it => (it.info ? null : { title: it.title, artist: it.artist }));
      lookupMany(targets.map(t => t || { title: '' }), {
        isCancelled: () => token !== trimToken,
        onResult: (i, info) => { if (!targets[i]) return; parsed[i].info = info; applyEstimate(i); trimSummary(); }
      });
    }
    trimCb.addEventListener('change', () => { store.setSetting('trimGaps', trimCb.checked); runTrim(); });
    tailIn.addEventListener('change', () => {
      store.setSetting('trimTail', Math.min(20, Math.max(0, parseInt(tailIn.value, 10) || 0)));
      parsed.forEach((_, i) => applyEstimate(i)); trimSummary();
    });

    function reparse() {
      parsed = parseSetlist(ta.value, { gap: parseFloat(gap.value) || 0 });
      preview.replaceChildren();
      if (!parsed.length) {
        summary.textContent = ta.value.trim() ? 'タイムスタンプ（例 1:23 や 1:02:03）が見つかりません' : '';
        btnCurrent.disabled = btnNew.disabled = true;
        return;
      }
      rowRefs.length = 0;
      const table = h('table.setlist-table',
        h('thead', h('tr', h('th', ''), h('th', '開始'), h('th', '終了'), h('th', '曲名'), h('th', 'アーティスト'), h('th', ''))),
        h('tbody', ...parsed.map((it, i) => {
          it.use = true;
          const cb = h('input', { type: 'checkbox', checked: true, onchange: (e) => { it.use = e.target.checked; updateSummary(); } });
          // 曲名・アーティストを直したら、その曲だけ調べ直す
          const relook = () => { it.info = null; applyEstimate(i); if (state.settings.trimGaps) runTrim(); };
          const t = h('input.input.xs', { type: 'text', value: it.title, oninput: (e) => { it.title = e.target.value; }, onchange: relook });
          const a = h('input.input.xs', { type: 'text', value: it.artist, oninput: (e) => { it.artist = e.target.value; }, onchange: relook });
          const endCell = h('td.mono', it.end ? formatTime(it.end) : '最後');
          const estCell = h('td.trim-cell');
          rowRefs[i] = { end: endCell, est: estCell };
          return h('tr', h('td', cb), h('td.mono', formatTime(it.start)), endCell, h('td', t), h('td', a), estCell);
        }))
      );
      preview.appendChild(table);
      updateSummary();
      runTrim();
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
        videoId: v.videoId, title: it.title, artist: it.artist, start: it.start, end: it.est ? it.est.end : it.end, rating: 3, article: v.title, singer: v.author
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
      h('div.field-row.setlist-opts.trim-opts',
        h('label.check', trimCb, h('span', h('b', '曲間をカット'), '（原曲の長さで終わりを推定）')),
        h('span', '余韻'), tailIn, h('span', '秒'), trimStatus,
        h('span.info-tip', { tabindex: 0, title: TRIM_NOTE }, icon('info'))),
      preview,
      h('div.btn-row', btnNew, btnCurrent)
    );
    if (prefill.url) { pv.input.value = prefill.url; pv.input.dispatchEvent(new Event('input')); }
    if (prefill.text) { ta.value = prefill.text; reparse(); }
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
    if (prefill.text) { ta.value = prefill.text; ta.dispatchEvent(new Event('input')); }
  }

  function renderBody() {
    if (tab === 'url') renderUrl();
    else if (tab === 'setlist') renderSetlist();
    else renderFile();
  }
  renderTabs();
  renderBody();
  prefill = {};
  void toast; void store; void state;
  return modal;
}
