// 曲間カット（原曲の長さから曲の終わりを推定）の画面部品

import { h } from './dom.js';
import { openModal } from './dialog.js';
import { state } from '../core/store.js';
import * as store from '../core/store.js';
import { formatTime } from '../core/time.js';
import { hasValidEnd } from '../core/model.js';
import { estimateEnd } from '../core/tracklen.js';
import { lookupTrack, lookupMany } from '../app/tracklookup.js';
import { toast, toastSuccess } from './toast.js';

export const TRIM_NOTE = '原曲の長さは Apple Music のカタログから調べます（無料・登録不要）。ライブでは原曲より長く／短く歌うこともあるので、気になる曲は取り込んだ後に「終わりを試聴」で確認してください。';

// 推定結果のバッジ
export function estimateBadge(info, est) {
  if (!info) return h('span.trim-badge.wait', '…');
  if (info.error) return h('span.trim-badge.muted', { title: info.error }, '取得失敗');
  if (info.miss) return h('span.trim-badge.muted', { title: '原曲が見つかりませんでした' }, '見つからず');
  const tip = `原曲: ${info.trackName}${info.artistName ? ' / ' + info.artistName : ''}（${formatTime(info.seconds)}）`;
  if (!est) return h('span.trim-badge.muted', { title: tip + ' — 変更なし' }, `原曲 ${formatTime(info.seconds)}`);
  if (est.cut == null) return h('span.trim-badge.ok', { title: tip }, `推定 ${formatTime(info.seconds)}`);
  return h('span.trim-badge.cut', { title: tip }, `−${formatTime(est.cut)}`);
}

// 推定しなかった理由（1曲の編集用）
export function whyNot(song, seconds) {
  if (!(seconds >= 45)) return '原曲が短すぎるため使いません';
  if (hasValidEnd(song) && song.end - song.start < seconds * 0.85) return '区間が原曲より短いため変更しません（TVサイズやメドレーかもしれません）';
  return 'すでに原曲の長さに近いので変更しません';
}

// 1曲ぶん: 推定して { end, info } を返す（推定できなければ理由をトースト）
export async function estimateOne(song) {
  let info;
  try { info = await lookupTrack(song); }
  catch { toast('原曲の長さを調べられませんでした（ネットワークを確認してください）'); return null; }
  if (info.miss) { toast(`「${song.title}」の原曲が見つかりませんでした。アーティストを入れると見つかりやすくなります`, { duration: 3500 }); return null; }
  const est = estimateEnd({ start: song.start, end: hasValidEnd(song) ? song.end : 0, duration: info.seconds, tail: state.settings.trimTail });
  if (!est) { toast(`原曲「${info.trackName}」（${formatTime(info.seconds)}）: ${whyNot(song, info.seconds)}`, { duration: 3500 }); return null; }
  return { end: est.end, info, est };
}

// プレイリスト全体の曲間を詰める（確認画面つき）
export function openTrimDialog(playlistId) {
  const pl = store.playlistById(playlistId);
  if (!pl || !pl.songs.length) { toast('プレイリストが空です'); return; }
  const rows = pl.songs.map(song => ({ song, info: null, est: null, use: false }));
  let tail = state.settings.trimTail;
  let cancelled = false;
  const status = h('div.trim-status', '原曲の長さを調べています…');
  const tailInput = h('input.input.xs', { type: 'number', min: 0, max: 20, step: 1, value: tail });
  const tbody = h('tbody');
  const content = h('div.trim-dialog',
    h('p.modal-text', `「${pl.name}」の各曲について、原曲の長さから曲の終わりを推定し、曲のあとのトークや無音をカットします。終わりを短くするだけで、延ばすことはありません。`),
    h('div.field-row.trim-opts', h('label', '原曲の長さに'), tailInput, h('span', '秒の余韻を足す'), status),
    h('div.setlist-preview.trim-table-wrap',
      h('table.setlist-table', h('thead', h('tr', h('th', ''), h('th', '曲名'), h('th', '開始'), h('th', 'いまの終了'), h('th', '新しい終了'), h('th', ''))), tbody)),
    h('p.hint', TRIM_NOTE));

  function recompute(r) {
    if (!r.info || !r.info.seconds) { r.est = null; r.use = false; return; }
    r.est = estimateEnd({ start: r.song.start, end: hasValidEnd(r.song) ? r.song.end : 0, duration: r.info.seconds, tail });
    r.use = !!r.est;
  }
  function renderRows() {
    tbody.replaceChildren(...rows.map(r => {
      const cb = h('input', { type: 'checkbox', checked: r.use, disabled: !r.est, onchange: (e) => { r.use = e.target.checked; summarize(); } });
      return h('tr', { class: r.est ? '' : 'muted' },
        h('td', cb), h('td.trim-title', r.song.title),
        h('td.mono', formatTime(r.song.start)),
        h('td.mono', hasValidEnd(r.song) ? formatTime(r.song.end) : '最後'),
        h('td.mono', r.est ? formatTime(r.est.end) : '—'),
        h('td', estimateBadge(r.info, r.est)));
    }));
  }
  function summarize() {
    const done = rows.filter(r => r.info).length;
    const chosen = rows.filter(r => r.use && r.est);
    const cut = chosen.reduce((a, r) => a + (r.est.cut || 0), 0);
    status.textContent = done < rows.length
      ? `原曲の長さを調べています ${done} / ${rows.length}`
      : `${chosen.length}曲を変更（合計 ${formatTime(cut)} カット）`;
    if (applyBtn) applyBtn.disabled = !chosen.length;
  }
  tailInput.addEventListener('change', () => {
    tail = Math.min(20, Math.max(0, parseInt(tailInput.value, 10) || 0));
    store.setSetting('trimTail', tail);
    rows.forEach(recompute);
    renderRows(); summarize();
  });

  const modal = openModal({
    title: '曲間を詰める', content, size: 'lg',
    onClose: () => { cancelled = true; },
    actions: [
      { label: 'キャンセル' },
      { label: '変更する', primary: true, onClick: () => {
        const chosen = rows.filter(r => r.use && r.est);
        const before = chosen.map(r => ({ id: r.song.id, end: r.song.end }));
        chosen.forEach(r => store.updateSong(r.song.id, { end: r.est.end }));
        toastSuccess(`${chosen.length}曲の終わりを詰めました`, {
          duration: 7000,
          action: { text: '元に戻す', callback: () => before.forEach(b => store.updateSong(b.id, { end: b.end })) }
        });
      } }
    ]
  });
  const applyBtn = modal.box.querySelector('.modal-footer .btn-primary');
  applyBtn.disabled = true;
  renderRows();
  summarize();
  lookupMany(rows.map(r => r.song), {
    isCancelled: () => cancelled,
    onResult: (i, info) => { rows[i].info = info; recompute(rows[i]); renderRows(); summarize(); }
  });
  return modal;
}


