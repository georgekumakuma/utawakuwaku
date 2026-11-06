// 下部プレイヤーバー: 再生操作・区間シークバー・音量・速度・パネル切替

import { h, icon } from './dom.js';
import { state, commit } from '../core/store.js';
import * as store from '../core/store.js';
import * as actions from '../app/actions.js';
import { ctx } from '../app/context.js';
import { thumbUrl } from '../core/ytid.js';
import { formatTime } from '../core/time.js';
import { hasValidEnd } from '../core/model.js';
import { showMenu } from './menu.js';

export function mountPlayerbar(root) {
  const thumb = h('img.pb-thumb', { alt: '', draggable: false });
  const pbTitle = h('div.pb-title', '—');
  const pbSub = h('div.pb-sub', '');
  const btnShuffle = h('button.icon-btn.pb-mode', { type: 'button', title: 'シャッフル (S)', onclick: () => actions.toggleShuffle() }, icon('shuffle'));
  const btnPrev = h('button.icon-btn', { type: 'button', title: '前の曲 (←)', onclick: () => actions.prev() }, icon('prev'));
  const btnPlay = h('button.pb-play', { type: 'button', title: '再生/一時停止 (Space)', onclick: () => actions.togglePlay() }, icon('play'));
  const btnNext = h('button.icon-btn', { type: 'button', title: '次の曲 (→)', onclick: () => actions.next() }, icon('next'));
  const btnRepeat = h('button.icon-btn.pb-mode', { type: 'button', title: 'リピート (R)', onclick: () => actions.cycleRepeat() }, icon('repeat'));
  const btnStop = h('button.icon-btn.pb-stop', { type: 'button', title: '停止', onclick: () => actions.stop() }, icon('stop'));

  const cur = h('span.pb-time', '0:00');
  const tot = h('span.pb-time', '0:00');
  const fill = h('div.seek-fill');
  const knob = h('div.seek-knob');
  const hover = h('div.seek-hover');
  const track = h('div.seek-track', fill, knob, hover);
  const seek = h('div.seekbar', cur, track, tot);

  const volIcon = h('button.icon-btn', { type: 'button', title: 'ミュート (M)', onclick: () => actions.toggleMute() }, icon('volume'));
  const vol = h('input.vol', { type: 'range', min: 0, max: 100, value: state.settings.volume, 'aria-label': '音量' });
  vol.addEventListener('input', () => actions.setVolume(parseInt(vol.value, 10)));
  const rateBtn = h('button.btn.btn-ghost.sm.pb-rate', { type: 'button', title: '再生速度', onclick: (e) => {
    showMenu([0.5, 0.75, 1, 1.25, 1.5, 2].map(r => ({ label: `${r}x`, checked: ctx.engine.state.rate === r, onClick: () => actions.setRate(r) })), { anchor: e.currentTarget });
  } }, '1x');
  const btnSleep = h('button.icon-btn.pb-panel.pb-sleep', { type: 'button', title: 'スリープタイマー', onclick: (e) => {
    const sl = state.ui.sleep;
    showMenu([
      { heading: 'スリープタイマー' },
      ...[15, 30, 45, 60, 90].map(m => ({ label: `${m}分後に停止`, onClick: () => actions.setSleepTimer(m) })),
      { label: 'この曲の終わりで停止', checked: !!(sl && sl.mode === 'song'), onClick: () => actions.setSleepTimer('song') },
      sl ? 'sep' : null,
      sl ? { label: '解除', icon: 'close', onClick: () => actions.setSleepTimer(null) } : null
    ].filter(Boolean), { anchor: e.currentTarget });
  } }, icon('clock'), h('span.pb-sleep-badge'));
  const btnTheater = h('button.icon-btn.pb-panel', { type: 'button', title: 'シアターモード (T)', onclick: () => import('./theater.js').then(m => m.openTheater()) }, icon('theater'));
  const btnEditor = h('button.icon-btn.pb-panel', { type: 'button', title: '編集パネル', onclick: () => actions.togglePanel('editor') }, icon('edit'));
  const btnQueue = h('button.icon-btn.pb-panel', { type: 'button', title: 'キュー (Q)', onclick: () => actions.togglePanel('queue') }, icon('queue'));
  const btnVideo = h('button.icon-btn.pb-panel', { type: 'button', title: '映像を隠す/表示 (V)', onclick: () => store.setSetting('showVideo', !state.settings.showVideo) }, icon('video'));

  root.append(
    h('div.pb-progress-mobile', h('div.pb-progress-mobile-fill')),
    h('div.pb-left', thumb, h('div.pb-text', pbTitle, pbSub)),
    h('div.pb-center',
      h('div.pb-transport', btnShuffle, btnPrev, btnPlay, btnNext, btnRepeat, btnStop),
      seek
    ),
    h('div.pb-right', rateBtn, h('div.pb-volume', volIcon, vol), btnSleep, btnVideo, btnTheater, btnEditor, btnQueue)
  );
  thumb.addEventListener('error', () => { thumb.style.visibility = 'hidden'; });
  // ミニプレイヤー: タップで全画面プレイヤー、左右スワイプで曲送り、上スワイプで全画面
  const left = root.querySelector('.pb-left');
  let sw = null;
  left.addEventListener('pointerdown', (ev) => { sw = { x: ev.clientX, y: ev.clientY, id: ev.pointerId, t: performance.now() }; });
  left.addEventListener('pointermove', (ev) => {
    if (!sw || ev.pointerId !== sw.id || ev.pointerType === 'mouse') return;
    const dx = ev.clientX - sw.x;
    left.style.transform = `translateX(${dx * 0.5}px)`;
    left.style.opacity = String(1 - Math.min(0.6, Math.abs(dx) / 300));
  });
  const endSwipe = (ev) => {
    if (!sw || ev.pointerId !== sw.id) return;
    const dx = ev.clientX - sw.x, dy = ev.clientY - sw.y;
    const quick = performance.now() - sw.t < 600;
    sw = null;
    left.style.transform = '';
    left.style.opacity = '';
    const vib = () => { try { navigator.vibrate && navigator.vibrate(8); } catch { /* ignore */ } };
    if (ev.pointerType !== 'mouse' && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { vib(); if (dx < 0) actions.next(); else actions.prev(); return; }
    if (ev.pointerType !== 'mouse' && dy < -40 && quick) { vib(); import('./theater.js').then(m => m.openTheater()); return; }
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) import('./theater.js').then(m => m.openTheater());
  };
  left.addEventListener('pointerup', endSwipe);
  left.addEventListener('pointercancel', () => { sw = null; left.style.transform = ''; left.style.opacity = ''; });

  // ----- シーク -----
  let scrubbing = false;
  function ratioFromEvent(ev) {
    const r = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
  }
  function segment() {
    const e = ctx.engine; const s = e && e.state.song;
    if (!s) return null;
    const end = hasValidEnd(s) ? s.end : e.state.duration;
    return end > s.start ? { start: s.start, end } : null;
  }
  track.addEventListener('pointerdown', (ev) => {
    const seg = segment(); if (!seg) return;
    scrubbing = true;
    track.setPointerCapture(ev.pointerId);
    const apply = (e2) => { const r = ratioFromEvent(e2); fill.style.width = (r * 100) + '%'; knob.style.left = (r * 100) + '%'; cur.textContent = formatTime(r * (seg.end - seg.start)); };
    apply(ev);
    const onMove = (e2) => apply(e2);
    const onUp = (e2) => {
      scrubbing = false;
      track.removeEventListener('pointermove', onMove);
      track.removeEventListener('pointerup', onUp);
      track.removeEventListener('pointercancel', onUp);
      ctx.engine.seekRatio(ratioFromEvent(e2));
    };
    track.addEventListener('pointermove', onMove);
    track.addEventListener('pointerup', onUp);
    track.addEventListener('pointercancel', onUp);
  });
  track.addEventListener('pointermove', (ev) => {
    const seg = segment(); if (!seg) { hover.style.display = 'none'; return; }
    const r = ratioFromEvent(ev);
    hover.style.display = '';
    hover.style.left = (r * 100) + '%';
    hover.textContent = formatTime(r * (seg.end - seg.start));
  });
  track.addEventListener('pointerleave', () => { hover.style.display = 'none'; });

  // ----- 描画 -----
  let lastVideo = null;
  function render() {
    const e = ctx.engine; if (!e) return;
    const s = e.state.song;
    const st = e.state.status;
    root.classList.toggle('has-song', !!s);
    root.classList.toggle('is-playing', st === 'playing' || st === 'preview');
    btnPlay.replaceChildren(icon(st === 'playing' || st === 'preview' ? 'pause' : 'play'));
    btnPlay.classList.toggle('loading', st === 'loading');
    btnShuffle.classList.toggle('on', e.state.shuffle);
    btnRepeat.classList.toggle('on', e.state.repeat !== 'off');
    btnRepeat.replaceChildren(icon(e.state.repeat === 'one' ? 'repeatOne' : 'repeat'));
    btnRepeat.title = { all: 'リピート: 全曲 (R)', one: 'リピート: 1曲 (R)', off: 'リピート OFF (R)' }[e.state.repeat];
    volIcon.replaceChildren(icon(e.state.muted || e.state.volume === 0 ? 'mute' : 'volume'));
    if (document.activeElement !== vol) vol.value = e.state.muted ? 0 : e.state.volume;
    vol.style.setProperty('--v', (e.state.muted ? 0 : e.state.volume) + '%');
    rateBtn.textContent = `${e.state.rate}x`;
    rateBtn.classList.toggle('on', e.state.rate !== 1);
    btnEditor.classList.toggle('on', state.ui.editorOpen && state.ui.panel === 'editor');
    btnQueue.classList.toggle('on', state.ui.editorOpen && state.ui.panel === 'queue');
    btnVideo.classList.toggle('on', !state.settings.showVideo);
    renderSleep();
    if (s) {
      pbTitle.textContent = s.title || '(無題)';
      pbSub.textContent = [s.artist, s.article].filter(Boolean).join(' · ');
      if (s.videoId !== lastVideo) { lastVideo = s.videoId; thumb.style.visibility = ''; thumb.src = thumbUrl(s.videoId, 'default'); }
    } else {
      pbTitle.textContent = '—'; pbSub.textContent = ''; lastVideo = null; thumb.removeAttribute('src');
      fill.style.width = '0%'; knob.style.left = '0%'; cur.textContent = '0:00'; tot.textContent = '0:00';
      root.querySelector('.pb-progress-mobile-fill').style.width = '0%';
    }
  }

  function renderSleep() {
    const sl = state.ui.sleep;
    const badge = btnSleep.querySelector('.pb-sleep-badge');
    btnSleep.classList.toggle('on', !!sl);
    if (!sl) { badge.textContent = ''; btnSleep.title = 'スリープタイマー'; return; }
    if (sl.mode === 'song') { badge.textContent = '♪'; btnSleep.title = 'この曲の終わりで停止'; return; }
    const min = Math.max(1, Math.ceil((sl.until - Date.now()) / 60000));
    badge.textContent = String(min);
    btnSleep.title = `あと${min}分で停止`;
  }
  setInterval(renderSleep, 15000);

  function tick(t) {
    if (scrubbing) return;
    const seg = segment();
    if (!seg) { if (t.duration && ctx.engine.state.song) { tot.textContent = formatTime(t.duration); cur.textContent = formatTime(t.cur); } return; }
    const len = seg.end - seg.start;
    const ratio = Math.max(0, Math.min(1, (t.cur - seg.start) / len));
    fill.style.width = (ratio * 100) + '%';
    knob.style.left = (ratio * 100) + '%';
    root.querySelector('.pb-progress-mobile-fill').style.width = (ratio * 100) + '%';
    cur.textContent = formatTime(Math.max(0, t.cur - seg.start));
    tot.textContent = formatTime(len);
  }

  if (ctx.engine) { ctx.engine.on('change', render); ctx.engine.on('tick', tick); }
  store.on('ui', render);
  store.on('settings', render);
  render();
  void commit;
}
