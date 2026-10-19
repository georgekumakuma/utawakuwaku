// 区間エディタ（右パネル）
// タイムライン上のドラッグ、I/O キーでの打刻、±ボタンでの微調整、開始・終了の試聴ができる。

import { h, icon, stars, setStars, debounce } from './dom.js';
import { state, commit } from '../core/store.js';
import * as store from '../core/store.js';
import * as actions from '../app/actions.js';
import { ctx } from '../app/context.js';
import { parseTime, formatTime, roundTenth } from '../core/time.js';
import { parseYouTubeInput, isValidVideoId, thumbUrl } from '../core/ytid.js';
import { normalizeSong, hasValidEnd } from '../core/model.js';
import { fetchVideoInfo } from '../player/yt.js';
import { toast, toastError, toastSuccess } from './toast.js';
import { confirmDialog } from './dialog.js';

export function mountEditor(root) {
  let draft = null;         // 編集中のコピー
  let editingId = null;     // 既存曲のID（null なら新規）
  let info = null;          // oEmbed で取得した動画情報
  let dirty = false;

  // ----- 要素 -----
  const title = h('h3.panel-title', '曲を編集');
  const videoInput = h('input.input', { type: 'text', placeholder: 'YouTube URL または 動画ID', autocomplete: 'off' });
  const videoLoadBtn = h('button.btn.btn-ghost.sm', { type: 'button', title: 'プレイヤーに読み込む', onclick: () => loadIntoPlayer(true) }, icon('video'), ' 読み込む');
  const videoInfo = h('div.editor-videoinfo');

  const tlRange = h('div.tl-range');
  const tlStart = h('div.tl-handle.tl-start', { title: '開始（ドラッグ）' });
  const tlEnd = h('div.tl-handle.tl-end', { title: '終了（ドラッグ）' });
  const tlHead = h('div.tl-playhead');
  const tlTrack = h('div.tl-track', tlRange, tlStart, tlEnd, tlHead);
  const tlLabelL = h('span', '0:00');
  const tlLabelR = h('span', '—');
  const tlHint = h('div.tl-hint', '');
  const timeline = h('div.timeline', tlTrack, h('div.tl-labels', tlLabelL, tlHint, tlLabelR));

  const startInput = h('input.input.time-input', { type: 'text', inputmode: 'numeric', placeholder: '0:00' });
  const endInput = h('input.input.time-input', { type: 'text', inputmode: 'numeric', placeholder: '最後まで' });
  const lenLabel = h('span.editor-len');

  function nudgeBtn(field, delta) {
    return h('button.btn.btn-ghost.xs', { type: 'button', title: `${delta > 0 ? '+' : ''}${delta}秒`, onclick: () => nudge(field, delta) }, `${delta > 0 ? '+' : ''}${delta}`);
  }
  const startRow = h('div.time-row',
    h('div.time-label', '開始', h('kbd', 'I')),
    h('div.time-controls',
      nudgeBtn('start', -5), nudgeBtn('start', -1), nudgeBtn('start', -0.1), startInput, nudgeBtn('start', 0.1), nudgeBtn('start', 1), nudgeBtn('start', 5)),
    h('div.time-actions',
      h('button.btn.btn-ghost.sm', { type: 'button', title: '再生中の位置を開始にする (I)', onclick: () => markFromPlayer('start') }, icon('flag'), ' 現在位置'),
      h('button.btn.btn-ghost.sm', { type: 'button', title: '開始から5秒を試聴', onclick: () => previewStart() }, icon('play'), ' 試聴'))
  );
  const endRow = h('div.time-row',
    h('div.time-label', '終了', h('kbd', 'O')),
    h('div.time-controls',
      nudgeBtn('end', -5), nudgeBtn('end', -1), nudgeBtn('end', -0.1), endInput, nudgeBtn('end', 0.1), nudgeBtn('end', 1), nudgeBtn('end', 5)),
    h('div.time-actions',
      h('button.btn.btn-ghost.sm', { type: 'button', title: '再生中の位置を終了にする (O)', onclick: () => markFromPlayer('end') }, icon('flag'), ' 現在位置'),
      h('button.btn.btn-ghost.sm', { type: 'button', title: '終了の手前4秒を試聴', onclick: () => previewEnd() }, icon('play'), ' 終わりを試聴'),
      h('button.btn.btn-ghost.sm', { type: 'button', title: '動画の最後まで再生する', onclick: () => { setField('end', 0); } }, '最後まで'))
  );

  const titleInput = h('input.input', { type: 'text', placeholder: '曲名 / シーン名（必須）' });
  const artistInput = h('input.input', { type: 'text', placeholder: 'アーティスト（原曲）' });
  const articleInput = h('input.input', { type: 'text', placeholder: '配信・動画のタイトル（自動取得）' });
  const singerInput = h('input.input', { type: 'text', placeholder: '歌い手 / チャンネル名' });
  const tagsInput = h('input.input', { type: 'text', placeholder: 'タグ（スペース区切り: バラード アニソン）' });
  const noteInput = h('textarea.input', { rows: 2, placeholder: 'メモ' });
  const ratingStars = stars(3, { interactive: true, onChange: (v) => { draft.rating = v; setStars(ratingStars, v); touch(); } });
  const targetSel = h('select.select.sm', { title: '追加先のプレイリスト' });

  const btnSave = h('button.btn.btn-primary', { type: 'button', onclick: () => save() }, icon('check'), ' 保存');
  const btnSaveNext = h('button.btn.btn-ghost', { type: 'button', title: '保存して、終了位置から次の区間を続けて作る', onclick: () => save({ continueNext: true }) }, icon('next'), ' 保存して次の区間');
  const btnAddNew = h('button.btn.btn-ghost', { type: 'button', title: 'この内容を別の曲として追加', onclick: () => save({ asNew: true }) }, icon('plus'), ' 別の曲として追加');
  const btnDelete = h('button.btn.btn-ghost.danger', { type: 'button', onclick: () => remove() }, icon('trash'));
  const errBox = h('div.form-error');

  root.append(
    h('div.panel-head', title, h('button.icon-btn', { type: 'button', title: '閉じる (Esc)', onclick: () => actions.closeEditor() }, icon('close'))),
    h('div.panel-body.editor-body',
      h('div.field', h('label', '動画'), h('div.field-row', videoInput, videoLoadBtn), videoInfo),
      timeline,
      startRow, endRow,
      h('div.editor-lenrow', lenLabel),
      h('div.field', h('label', '曲名 / シーン名'), titleInput),
      h('div.field-2',
        h('div.field', h('label', 'アーティスト'), artistInput),
        h('div.field', h('label', '歌い手 / チャンネル'), singerInput)),
      h('div.field', h('label', '配信・動画タイトル'), articleInput),
      h('div.field-2',
        h('div.field', h('label', 'タグ'), tagsInput),
        h('div.field', h('label', '評価'), h('div.field-stars', ratingStars))),
      h('div.field', h('label', 'メモ'), noteInput),
      h('div.field.field-target', h('label', '追加先'), targetSel),
      errBox
    ),
    h('div.panel-foot', btnSave, btnSaveNext, btnAddNew, btnDelete)
  );

  // ----- 入力ハンドラ -----
  const bindText = (input, key) => input.addEventListener('input', () => { draft[key] = input.value; touch(); });
  bindText(titleInput, 'title'); bindText(artistInput, 'artist'); bindText(articleInput, 'article');
  bindText(singerInput, 'singer'); bindText(noteInput, 'note');
  tagsInput.addEventListener('input', () => { draft.tags = tagsInput.value.split(/[\s,、#]+/).filter(Boolean); touch(); });
  const commitTime = (input, key) => {
    const v = parseTime(input.value);
    if (input.value.trim() === '' && key === 'end') { setField('end', 0); return; }
    if (isNaN(v)) { input.classList.add('invalid'); return; }
    input.classList.remove('invalid');
    setField(key, v, { fromInput: true });
  };
  startInput.addEventListener('change', () => commitTime(startInput, 'start'));
  endInput.addEventListener('change', () => commitTime(endInput, 'end'));
  [startInput, endInput].forEach(inp => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } }));
  videoInput.addEventListener('change', () => {
    const p = parseYouTubeInput(videoInput.value);
    if (!p) { videoInput.classList.add('invalid'); return; }
    videoInput.classList.remove('invalid');
    if (p.videoId !== draft.videoId) {
      draft.videoId = p.videoId;
      info = null;
      if (p.start && !draft.start) draft.start = p.start;
      touch();
      renderVideoInfo();
      fetchInfo();
    }
  });
  const fetchInfo = debounce(async () => {
    if (!draft || !isValidVideoId(draft.videoId)) return;
    const vid = draft.videoId;
    try {
      const i = await fetchVideoInfo(vid);
      if (!draft || draft.videoId !== vid) return;
      info = i;
      if (!draft.article) { draft.article = i.title; articleInput.value = i.title; }
      if (!draft.singer) { draft.singer = i.author; singerInput.value = i.author; }
      renderVideoInfo();
    } catch { /* 取得できなくても続行 */ }
  }, 250);

  function touch() { dirty = true; renderTimes(); }

  function setField(key, value, { fromInput = false } = {}) {
    value = roundTenth(Math.max(0, value));
    if (key === 'start') {
      draft.start = value;
      if (hasValidEnd(draft) && draft.end <= draft.start) draft.end = roundTenth(draft.start + 1);
    } else {
      draft.end = value;
    }
    dirty = true;
    renderTimes();
    void fromInput;
  }

  function nudge(key, delta) {
    const base = key === 'end' && !hasValidEnd(draft) ? (playerDuration() || draft.start) : draft[key];
    setField(key, base + delta);
    if (sameVideoLoaded()) ctx.engine.seek(key === 'end' ? Math.max(draft.start, draft.end - 3) : draft.start);
  }

  function sameVideoLoaded() {
    const e = ctx.engine;
    return !!(e && e.ready && draft && e.state.song && e.state.song.videoId === draft.videoId && (e.activeDeck && e.activeDeck.loadedVideoId === draft.videoId));
  }
  function playerDuration() {
    return sameVideoLoaded() ? ctx.engine.state.duration : 0;
  }

  function markFromPlayer(key) {
    if (!sameVideoLoaded()) { toast('先に「読み込む」で動画をプレイヤーに読み込んでください', { duration: 2500 }); loadIntoPlayer(true); return; }
    setField(key, ctx.engine.state.cur);
    toast(`${key === 'start' ? '開始' : '終了'}位置を ${formatTime(draft[key], { frac: true })} に設定`, { duration: 1200 });
  }

  function loadIntoPlayer(autoplay) {
    if (!draft || !isValidVideoId(draft.videoId)) { toastError('動画IDが正しくありません'); return; }
    if (!ctx.engine || !ctx.engine.ready) { toastError('プレイヤーの準備ができていません'); return; }
    ctx.engine.loadForEdit(draftForEngine(), { autoplay });
  }
  function draftForEngine() { return { ...draft, _draft: true }; }

  function previewStart() {
    if (!ctx.engine || !ctx.engine.ready) return;
    ctx.engine.preview(draftForEngine(), draft.start, draft.start + 5);
  }
  function previewEnd() {
    if (!ctx.engine || !ctx.engine.ready) return;
    const end = hasValidEnd(draft) ? draft.end : playerDuration();
    if (!end) { toast('終了位置が「最後まで」のため、試聴する区間がありません', { duration: 2000 }); return; }
    ctx.engine.preview(draftForEngine(), Math.max(draft.start, end - 4), end);
  }

  // ----- 描画 -----
  function renderVideoInfo() {
    if (!draft || !isValidVideoId(draft.videoId)) { videoInfo.replaceChildren(); return; }
    videoInfo.replaceChildren(
      h('img.editor-thumb', { src: thumbUrl(draft.videoId, 'default'), alt: '', onerror: (e) => { e.target.style.visibility = 'hidden'; } }),
      h('div.editor-videoinfo-text',
        h('div.editor-videotitle', info ? info.title : draft.article || draft.videoId),
        h('div.editor-videoauthor', info ? info.author : (sameVideoLoaded() ? '読み込み済み' : '')))
    );
  }

  function timelineDuration() {
    const d = playerDuration();
    if (d > 0) return d;
    return Math.max(draft.end, draft.start) + 60;
  }

  function renderTimes() {
    if (!draft) return;
    if (document.activeElement !== startInput) startInput.value = formatTime(draft.start, { frac: true });
    if (document.activeElement !== endInput) endInput.value = hasValidEnd(draft) ? formatTime(draft.end, { frac: true }) : '';
    lenLabel.textContent = hasValidEnd(draft) ? `区間の長さ: ${formatTime(draft.end - draft.start, { frac: true })}` : '区間の長さ: 動画の最後まで';
    const dur = timelineDuration();
    const end = hasValidEnd(draft) ? draft.end : dur;
    const l = Math.min(100, (draft.start / dur) * 100);
    const r = Math.min(100, (end / dur) * 100);
    tlRange.style.left = l + '%';
    tlRange.style.width = Math.max(0, r - l) + '%';
    tlStart.style.left = l + '%';
    tlEnd.style.left = r + '%';
    tlLabelR.textContent = playerDuration() ? formatTime(dur) : '動画未読み込み';
    timeline.classList.toggle('no-duration', !playerDuration());
    tlHint.textContent = `${formatTime(draft.start)} → ${hasValidEnd(draft) ? formatTime(draft.end) : '最後'}`;
  }

  function renderTargets() {
    targetSel.replaceChildren(...store.playlists().map(p => h('option', { value: p.id, selected: p.id === state.data.currentId }, `${p.icon ? p.icon + ' ' : ''}${p.name}`)));
    targetSel.parentElement.style.display = editingId ? 'none' : '';
  }

  function render() {
    const open = state.ui.editorOpen && state.ui.panel === 'editor';
    if (!open) return;
    const wantId = state.ui.editingId;
    const wantDraft = state.ui.draft;
    if (wantId !== editingId || (!wantId && wantDraft && wantDraft !== lastDraftRef)) {
      load(wantId, wantDraft);
    } else if (wantId && !dirty) {
      // 外部で更新されたら（評価の変更など）反映
      const found = store.findSong(wantId);
      if (found) { draft = normalizeSong({ ...found.song }); fill(); }
    }
    renderTargets();
  }

  let lastDraftRef = null;
  function load(id, d) {
    editingId = id;
    lastDraftRef = d || null;
    info = null;
    dirty = false;
    if (id) {
      const found = store.findSong(id);
      if (!found) { actions.closeEditor(); return; }
      draft = normalizeSong({ ...found.song });
      title.textContent = '曲を編集';
    } else {
      draft = normalizeSong({ videoId: 'xxxxxxxxxxx', title: '', start: 0, end: 0, rating: 3, ...(d || {}) });
      if (!isValidVideoId((d || {}).videoId || '')) draft.videoId = '';
      title.textContent = '新しい曲を追加';
    }
    fill();
    if (isValidVideoId(draft.videoId)) fetchInfo();
    btnDelete.style.display = id ? '' : 'none';
    btnAddNew.style.display = id ? '' : 'none';
    btnSaveNext.style.display = '';
    if (!id && !draft.videoId) setTimeout(() => videoInput.focus(), 50);
    else if (!id) setTimeout(() => titleInput.focus(), 50);
  }

  function fill() {
    videoInput.value = draft.videoId;
    videoInput.classList.remove('invalid');
    titleInput.value = draft.title;
    artistInput.value = draft.artist;
    articleInput.value = draft.article;
    singerInput.value = draft.singer;
    tagsInput.value = (draft.tags || []).join(' ');
    noteInput.value = draft.note;
    setStars(ratingStars, draft.rating);
    errBox.textContent = '';
    renderVideoInfo();
    renderTimes();
  }

  // ----- 保存・削除 -----
  function validate() {
    if (!isValidVideoId(draft.videoId)) return '動画のURLまたはIDを入力してください';
    if (!draft.title.trim()) return '曲名 / シーン名を入力してください';
    if (draft.end && draft.end <= draft.start) return '終了は開始より後にしてください（空欄で「最後まで」）';
    return '';
  }

  function save({ asNew = false, continueNext = false } = {}) {
    const err = validate();
    if (err) { errBox.textContent = err; toastError(err); return; }
    errBox.textContent = '';
    const song = normalizeSong({ ...draft, id: undefined });
    if (editingId && !asNew) {
      store.updateSong(editingId, song);
      dirty = false;
      toastSuccess('保存しました', { duration: 1500 });
      if (ctx.engine && ctx.engine.state.song && ctx.engine.state.song.id === editingId) {
        // 再生中の曲を編集した場合はエンジン側の表示も更新
        ctx.engine.changed();
      }
    } else {
      const target = store.playlistById(targetSel.value || state.data.currentId) || store.currentPlaylist();
      const [added] = store.addSongs(target.id, [song]);
      toastSuccess(`「${added.title}」を「${target.name}」に追加しました`, { duration: 2000 });
      if (!continueNext) {
        if (editingId) { /* 別の曲として追加: 編集元に戻る */ }
        else { editingId = added.id; state.ui.editingId = added.id; state.ui.draft = null; commit('ui'); }
      }
    }
    if (continueNext) {
      // 同じ動画で、終了位置から次の区間を続けて作る
      const nextStart = hasValidEnd(draft) ? draft.end : draft.start;
      const base = { videoId: draft.videoId, article: draft.article, singer: draft.singer, start: nextStart, end: 0, rating: draft.rating, tags: draft.tags.slice() };
      editingId = null;
      state.ui.editingId = null;
      state.ui.draft = base;
      commit('ui');
      load(null, base);
      if (sameVideoLoaded()) ctx.engine.seek(nextStart);
      titleInput.focus();
    }
  }

  async function remove() {
    if (!editingId) return;
    const found = store.findSong(editingId);
    if (!found) return;
    actions.deleteSongs(found.playlist.id, [editingId]);
  }

  // ----- タイムラインの操作 -----
  function tlRatio(ev) {
    const r = tlTrack.getBoundingClientRect();
    return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
  }
  [tlStart, tlEnd].forEach(handle => {
    handle.addEventListener('pointerdown', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      handle.setPointerCapture(ev.pointerId);
      const key = handle === tlStart ? 'start' : 'end';
      const dur = timelineDuration();
      const onMove = (e2) => { setField(key, tlRatio(e2) * dur); };
      const onUp = (e2) => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        setField(key, tlRatio(e2) * dur);
        if (sameVideoLoaded()) ctx.engine.seek(key === 'end' ? Math.max(draft.start, draft.end - 3) : draft.start);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
  });
  tlTrack.addEventListener('click', (ev) => {
    if (ev.target.classList.contains('tl-handle')) return;
    if (!sameVideoLoaded()) { loadIntoPlayer(true); return; }
    ctx.engine.seek(tlRatio(ev) * timelineDuration());
  });

  function tick(t) {
    if (!draft || !state.ui.editorOpen) return;
    if (!sameVideoLoaded()) { tlHead.style.display = 'none'; return; }
    const dur = timelineDuration();
    tlHead.style.display = '';
    tlHead.style.left = Math.min(100, (t.cur / dur) * 100) + '%';
    if (tlLabelR.textContent === '動画未読み込み' && dur) renderTimes();
  }

  store.on('ui', render);
  store.on('data', () => { if (state.ui.editorOpen) { renderTargets(); if (editingId && !dirty) render(); } });
  if (ctx.engine) {
    ctx.engine.on('tick', tick);
    ctx.engine.on('change', () => { if (state.ui.editorOpen && draft) { renderTimes(); renderVideoInfo(); } });
  }
  render();

  // 外部（ショートカット）から使う操作
  return {
    isOpen: () => state.ui.editorOpen && state.ui.panel === 'editor' && !!draft,
    markStart: () => markFromPlayer('start'),
    markEnd: () => markFromPlayer('end'),
    previewStart, previewEnd,
    save: () => save(),
    hasDirty: () => dirty
  };
}
