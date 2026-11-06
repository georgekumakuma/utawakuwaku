// シアターモード: 画面いっぱいの没入型プレイヤー
// - 動画（iframe）は DOM を移動すると再読み込みされてしまうため、CSS で position: fixed にして
//   画面中央の枠へ「飛んでいく」ように見せる（FLIP アニメーション）
// - 背景はアートワークの色のオーロラ、曲が変わるたびにパルス
// - スマホでは全画面プレイヤーとして使い、下にスワイプで閉じる・左右スワイプで曲送り

import { h, icon, stars, setStars, animateText, fill as fillChildren } from './dom.js';
import { state } from '../core/store.js';
import * as store from '../core/store.js';
import * as actions from '../app/actions.js';
import { ctx } from '../app/context.js';
import { thumbUrl } from '../core/ytid.js';
import { formatTime } from '../core/time.js';
import { hasValidEnd } from '../core/model.js';
import { Aurora } from './aurora.js';
import { getPalette } from './ambient.js';

let current = null;

export function isTheaterOpen() { return !!current; }
export function toggleTheater() { if (current) closeTheater(); else openTheater(); }

const root = () => document.documentElement.style;
function setVideoRect(r) {
  root().setProperty('--tv-x', r.left + 'px');
  root().setProperty('--tv-y', r.top + 'px');
  root().setProperty('--tv-w', r.width + 'px');
  root().setProperty('--tv-h', r.height + 'px');
}
function clearVideoRect() { ['--tv-x', '--tv-y', '--tv-w', '--tv-h'].forEach(k => root().removeProperty(k)); }

function videoShown() {
  const e = ctx.engine;
  return !!(e && e.state.song && state.settings.showVideo);
}

function segmentOf() {
  const e = ctx.engine; const s = e && e.state.song;
  if (!s) return null;
  const end = hasValidEnd(s) ? s.end : e.state.duration;
  return end > s.start ? { start: s.start, end } : null;
}

export function openTheater() {
  if (current) return;
  const e = ctx.engine;
  const body = document.body;
  const stageVideo = document.querySelector('.stage-video');
  const fromRect = stageVideo ? stageVideo.getBoundingClientRect() : null;

  // ----- DOM -----
  const auroraHost = h('div.th-aurora', { 'aria-hidden': 'true' });
  const art = h('img.th-art', { alt: '', draggable: false });
  const slot = h('div.th-slot', art);
  const kicker = h('div.th-kicker');
  const title = h('h1.th-title');
  const sub = h('div.th-sub');
  const chips = h('div.th-chips');
  const st = stars(1, { interactive: true, onChange: (v) => { const s = e.state.song; if (s && !s._draft) actions.rateSong(s.id, v); } });
  const cur = h('span.th-time');
  const tot = h('span.th-time');
  const fill = h('div.th-fill');
  const knob = h('div.th-knob');
  const hoverTip = h('div.th-hover');
  const bar = h('div.th-bar', fill, knob, hoverTip);
  const ringFg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  ring.setAttribute('viewBox', '0 0 100 100');
  ring.setAttribute('class', 'th-ring');
  ring.innerHTML = '<circle cx="50" cy="50" r="46" class="th-ring-bg"/>';
  ringFg.setAttribute('cx', '50'); ringFg.setAttribute('cy', '50'); ringFg.setAttribute('r', '46');
  ringFg.setAttribute('class', 'th-ring-fg');
  ring.appendChild(ringFg);
  const RING = 2 * Math.PI * 46;
  ringFg.style.strokeDasharray = String(RING);
  const btnPlay = h('button.th-play', { type: 'button', title: '再生/一時停止 (Space)', onclick: () => actions.togglePlay() }, ring, h('span.th-play-ic', icon('play')));
  const btnShuffle = h('button.th-btn.th-mode', { type: 'button', title: 'シャッフル (S)', onclick: () => actions.toggleShuffle() }, icon('shuffle'));
  const btnRepeat = h('button.th-btn.th-mode', { type: 'button', title: 'リピート (R)', onclick: () => actions.cycleRepeat() }, icon('repeat'));
  const vol = h('input.th-vol', { type: 'range', min: 0, max: 100, 'aria-label': '音量' });
  vol.addEventListener('input', () => actions.setVolume(parseInt(vol.value, 10)));
  const nextWrap = h('div.th-next-cards');
  const idle = h('div.th-idle',
    h('div.th-idle-mark', '♪'),
    h('p', '曲を選ぶと、ここが特等席になります'),
    h('div.th-idle-actions',
      h('button.btn.btn-primary', { type: 'button', onclick: () => actions.playRadio() }, '📻 おまかせラジオ'),
      h('button.btn.btn-ghost', { type: 'button', onclick: () => { const pl = store.currentPlaylist(); if (pl) actions.playPlaylist(pl.id); } }, icon('play'), ' プレイリストを再生')));

  const el = h('div.theater', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'シアターモード' },
    auroraHost,
    h('div.th-vignette'),
    h('header.th-top',
      h('button.th-back', { type: 'button', title: '通常の表示に戻る (Esc / T)', onclick: () => closeTheater() }, icon('chevronLeft'), h('span', '通常表示に戻る')),
      h('div.th-top-actions',
        h('button.th-btn', { type: 'button', title: '映像を隠す/表示 (V)', onclick: () => store.setSetting('showVideo', !state.settings.showVideo) }, icon('video')),
        h('span.th-brand', h('span.brand-mark', '♪'), h('span.th-brand-name', ' utawakuwaku')))),
    h('div.th-main',
      slot,
      h('div.th-info',
        kicker, title, sub,
        h('div.th-meta', st, chips),
        h('div.th-progress', cur, bar, tot),
        h('div.th-controls',
          btnShuffle,
          h('button.th-btn.th-big', { type: 'button', title: '前の曲 (←)', onclick: () => actions.prev() }, icon('prev')),
          btnPlay,
          h('button.th-btn.th-big', { type: 'button', title: '次の曲 (→)', onclick: () => actions.next() }, icon('next')),
          btnRepeat),
        h('div.th-volume', h('button.th-btn', { type: 'button', title: 'ミュート (M)', onclick: () => actions.toggleMute() }, icon('volume')), vol),
        idle)),
    h('aside.th-next', h('div.th-next-head', 'UP NEXT'), nextWrap)
  );
  art.addEventListener('error', () => { art.style.visibility = 'hidden'; });
  body.appendChild(el);

  const aurora = new Aurora(auroraHost);
  aurora.setColors(getPalette());
  aurora.start({ animate: state.settings.aurora });

  // ----- 動画の配置（FLIP） -----
  const placeVideo = () => {
    if (!videoShown()) return;
    setVideoRect(slot.getBoundingClientRect());
  };
  if (fromRect && fromRect.width > 20) setVideoRect(fromRect);
  else {
    const r = slot.getBoundingClientRect();
    setVideoRect({ left: r.left + r.width / 2 - 20, top: r.top + r.height / 2 - 12, width: 40, height: 24 });
  }
  body.classList.add('th-open');
  void el.offsetWidth;
  requestAnimationFrame(() => {
    body.classList.add('th-anim');
    el.classList.add('show');
    placeVideo();
  });
  el.addEventListener('transitionend', (ev) => { if (ev.target === el || ev.target === slot.parentElement) placeVideo(); });
  const ro = new ResizeObserver(() => placeVideo());
  ro.observe(slot);
  const onResize = () => placeVideo();
  window.addEventListener('resize', onResize);

  // ----- 描画 -----
  let lastSongId = null;
  function render() {
    const s = e.state.song;
    const status = e.state.status;
    el.classList.toggle('has-song', !!s);
    el.classList.toggle('show-video', videoShown());
    el.classList.toggle('playing', status === 'playing' || status === 'preview');
    aurora.setEnergy(status === 'playing' || status === 'preview' ? 1 : 0.35);
    btnPlay.querySelector('.th-play-ic').replaceChildren(icon(status === 'playing' || status === 'preview' ? 'pause' : 'play'));
    btnPlay.classList.toggle('loading', status === 'loading');
    btnShuffle.classList.toggle('on', e.state.shuffle);
    btnRepeat.classList.toggle('on', e.state.repeat !== 'off');
    btnRepeat.replaceChildren(icon(e.state.repeat === 'one' ? 'repeatOne' : 'repeat'));
    if (document.activeElement !== vol) vol.value = e.state.muted ? 0 : e.state.volume;
    vol.style.setProperty('--v', (e.state.muted ? 0 : e.state.volume) + '%');
    if (!s) {
      kicker.textContent = '';
      title.dataset.text = '';
      title.textContent = '';
      sub.textContent = '';
      chips.replaceChildren();
      art.removeAttribute('src');
      nextWrap.replaceChildren();
      lastSongId = null;
      return;
    }
    if (s.id !== lastSongId) {
      lastSongId = s.id;
      aurora.pulse();
      el.classList.remove('song-in');
      void el.offsetWidth;
      el.classList.add('song-in');
      art.style.visibility = '';
      art.src = thumbUrl(s.videoId, 'hqdefault');
    }
    const pl = e.state.playlistId ? store.playlistById(e.state.playlistId) : null;
    fillChildren(kicker, h('span.th-live', status === 'playing' ? 'NOW PLAYING' : status === 'paused' ? 'PAUSED' : status === 'preview' ? 'PREVIEW' : 'LOADING'),
      state.ui.radio ? h('span', ' · 📻 おまかせラジオ') : (pl ? h('span', ` · ${pl.icon ? pl.icon + ' ' : ''}${pl.name}`) : null));
    animateText(title, s.title || '(無題)', { stagger: 28, max: 40 });
    sub.textContent = [s.artist, s.singer, s.article].filter(Boolean).join(' · ');
    fillChildren(chips,
      ...(s.tags || []).slice(0, 4).map(t => h('span.th-chip', '#' + t)),
      s.playCount ? h('span.th-chip', `${s.playCount}回目`) : null
    );
    setStars(st, s.rating);
    renderNext();
    placeVideo();
  }

  function renderNext() {
    const up = e.upcoming(5);
    nextWrap.replaceChildren(...up.map((it, i) => {
      const card = h('button.th-card', { type: 'button', style: { '--i': String(i) }, title: `${it.song.title} を再生` },
        h('img', { src: thumbUrl(it.song.videoId, 'mqdefault'), alt: '', loading: 'lazy', onerror: (ev) => { ev.target.style.visibility = 'hidden'; } }),
        h('span.th-card-text', h('b', it.song.title), h('small', it.fromQueue ? '次に再生' : (it.song.artist || it.song.article || ''))));
      card.addEventListener('click', () => {
        if (it.fromQueue) { const q = e.state.queue[i]; e.removeFromQueue(i); e.playItem(q); }
        else actions.playSong(it.song.id);
      });
      card.addEventListener('pointermove', (ev) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--rx', `${((ev.clientY - r.top) / r.height - 0.5) * -14}deg`);
        card.style.setProperty('--ry', `${((ev.clientX - r.left) / r.width - 0.5) * 18}deg`);
      });
      card.addEventListener('pointerleave', () => { card.style.removeProperty('--rx'); card.style.removeProperty('--ry'); });
      return card;
    }));
  }

  // ----- 進捗 -----
  let scrubbing = false;
  function tick(t) {
    if (scrubbing) return;
    const seg = segmentOf();
    if (!seg) { fill.style.width = '0%'; knob.style.left = '0%'; ringFg.style.strokeDashoffset = String(RING); cur.textContent = '0:00'; tot.textContent = '0:00'; return; }
    const len = seg.end - seg.start;
    const r = Math.max(0, Math.min(1, (t.cur - seg.start) / len));
    fill.style.width = (r * 100) + '%';
    knob.style.left = (r * 100) + '%';
    ringFg.style.strokeDashoffset = String(RING * (1 - r));
    cur.textContent = formatTime(Math.max(0, t.cur - seg.start));
    tot.textContent = '-' + formatTime(Math.max(0, seg.end - t.cur));
  }
  const ratioAt = (ev) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)); };
  bar.addEventListener('pointerdown', (ev) => {
    const seg = segmentOf(); if (!seg) return;
    scrubbing = true;
    bar.setPointerCapture(ev.pointerId);
    bar.classList.add('scrub');
    const show = (x) => { const r = ratioAt(x); fill.style.width = (r * 100) + '%'; knob.style.left = (r * 100) + '%'; cur.textContent = formatTime(r * (seg.end - seg.start)); };
    show(ev);
    const move = (x) => show(x);
    const up = (x) => {
      scrubbing = false;
      bar.classList.remove('scrub');
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
      e.seekRatio(ratioAt(x));
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
  });
  bar.addEventListener('pointermove', (ev) => {
    const seg = segmentOf(); if (!seg) return;
    const r = ratioAt(ev);
    hoverTip.style.left = (r * 100) + '%';
    hoverTip.textContent = formatTime(r * (seg.end - seg.start));
  });

  // ----- スワイプ（タッチ） -----
  let sw = null;
  el.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse') return;
    if (ev.target.closest('button, input, .th-bar, .th-next')) return;
    sw = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
  });
  el.addEventListener('pointermove', (ev) => {
    if (!sw || ev.pointerId !== sw.id) return;
    const dx = ev.clientX - sw.x, dy = ev.clientY - sw.y;
    if (dy > 0 && Math.abs(dy) > Math.abs(dx)) el.style.setProperty('--drag-y', `${dy * 0.6}px`);
    else el.style.setProperty('--drag-x', `${dx * 0.35}px`);
  });
  const endSwipe = (ev) => {
    if (!sw || ev.pointerId !== sw.id) return;
    const dx = ev.clientX - sw.x, dy = ev.clientY - sw.y;
    sw = null;
    el.style.removeProperty('--drag-y');
    el.style.removeProperty('--drag-x');
    if (dy > 110 && Math.abs(dy) > Math.abs(dx) * 1.3) { haptic(); closeTheater(); return; }
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.3) { haptic(); if (dx < 0) actions.next(); else actions.prev(); }
  };
  el.addEventListener('pointerup', endSwipe);
  el.addEventListener('pointercancel', endSwipe);

  // ----- 購読 -----
  const offs = [
    e.on('change', render),
    e.on('tick', tick),
    store.on('settings', () => { render(); placeVideo(); }),
    store.on('data', render)
  ];
  const onPalette = (ev) => aurora.setColors(ev.detail);
  document.addEventListener('uta:palette', onPalette);
  const onPop = () => { if (current) closeTheater({ fromHistory: true }); };
  history.pushState({ uta: 'theater' }, '');
  window.addEventListener('popstate', onPop);

  current = {
    el, aurora, ro,
    from: fromRect,
    cleanup() {
      offs.forEach(off => off && off());
      document.removeEventListener('uta:palette', onPalette);
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
    }
  };
  render();
  tick({ cur: e.state.cur });
}

export function closeTheater({ fromHistory = false } = {}) {
  const c = current;
  if (!c) return;
  current = null;
  c.cleanup();
  const body = document.body;
  const wrap = document.querySelector('.stage-wrap');
  // 元の位置へ戻す（開いたときの位置。動画を表示していない場合はその場で消える）
  if (videoShown() && c.from && c.from.width > 20) setVideoRect(c.from);
  c.el.classList.remove('show');
  c.el.classList.add('closing');
  setTimeout(() => {
    body.classList.remove('th-open', 'th-anim');
    clearVideoRect();
    c.aurora.destroy();
    c.el.remove();
    if (wrap) wrap.style.removeProperty('opacity');
  }, 480);
  if (!fromHistory && history.state && history.state.uta === 'theater') history.back();
}

function haptic() { try { navigator.vibrate && navigator.vibrate(8); } catch { /* ignore */ } }
