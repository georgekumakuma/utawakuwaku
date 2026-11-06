// イントロクイズ: 曲の冒頭（またはランダムな位置）を数秒だけ聴いて、4択で曲名を当てるゲーム

import { h, icon } from './dom.js';
import { openModal, hasOpenModal } from './dialog.js';
import { state } from '../core/store.js';
import * as store from '../core/store.js';
import * as actions from '../app/actions.js';
import { ctx } from '../app/context.js';
import { thumbUrl } from '../core/ytid.js';
import { buildQuiz, quizPool, scoreAnswer, quizStart, grade, CHOICES } from '../core/quiz.js';
import { Aurora } from './aurora.js';
import { confetti } from './confetti.js';
import { toast, toastError } from './toast.js';

const ANSWER_EXTRA = 10;   // イントロが終わってから回答できる秒数
const LOAD_TIMEOUT = 12000;

let game = null;
export function isQuizOpen() { return !!game; }

function sources() {
  const lib = store.librarySongs().map(({ song, playlists }) => ({ song, playlistId: playlists[0].id }));
  return [
    { id: 'library', label: '📚 ライブラリ全体', items: lib },
    ...store.playlists().map(p => ({ id: p.id, label: `${p.icon || '♪'} ${p.name}`, items: p.songs.map(song => ({ song, playlistId: p.id })) }))
  ];
}

function segmented(options, value, onChange) {
  const wrap = h('div.seg', { role: 'radiogroup' });
  const render = (v) => wrap.replaceChildren(...options.map(([val, label]) =>
    h('button.seg-btn', { type: 'button', role: 'radio', 'aria-checked': String(val === v), class: val === v ? 'on' : '', onclick: () => { onChange(val); render(val); } }, label)));
  render(value);
  return wrap;
}

export function openQuizSetup() {
  const srcs = sources();
  let srcId = srcs.find(s => s.id === state.data.currentId) ? state.data.currentId : 'library';
  if (quizPool(srcs.find(s => s.id === srcId).items).length < CHOICES) srcId = 'library';
  const opts = { count: state.settings.quizCount, seconds: state.settings.quizSeconds, from: state.settings.quizFrom };
  const poolInfo = h('div.quiz-pool');
  const sel = h('select.select', ...srcs.map(s => h('option', { value: s.id, selected: s.id === srcId }, s.label)));
  const updatePool = () => {
    const n = quizPool(srcs.find(s => s.id === sel.value).items).length;
    poolInfo.textContent = n >= CHOICES ? `出題できる曲: ${n}曲` : `出題には曲名の違う曲が${CHOICES}曲以上必要です（いま${n}曲）`;
    poolInfo.classList.toggle('bad', n < CHOICES);
    startBtn && (startBtn.disabled = n < CHOICES);
  };
  sel.addEventListener('change', updatePool);
  const content = h('div.quiz-setup',
    h('div.quiz-hero', h('div.quiz-hero-ic', icon('game')), h('div',
      h('b', '曲の頭を聴いて、曲名を当てよう'),
      h('p', '速く答えるほど高得点。連続正解でボーナス。キーボードの 1〜4 でも答えられます。'))),
    h('div.field', h('label', '出題する曲'), sel, poolInfo),
    h('div.field', h('label', '問題数'), segmented([[5, '5問'], [10, '10問'], [20, '20問']], opts.count, v => { opts.count = v; })),
    h('div.field', h('label', '聴ける長さ'), segmented([[3, '3秒（難）'], [5, '5秒'], [10, '10秒（易）']], opts.seconds, v => { opts.seconds = v; })),
    h('div.field', h('label', '聴く場所'), segmented([['start', '曲の頭から'], ['random', '曲のどこか（上級）']], opts.from, v => { opts.from = v; })),
    state.settings.quizBest ? h('div.quiz-best', '🏆 ハイスコア ', h('b', state.settings.quizBest.toLocaleString())) : null
  );
  let startBtn = null;
  const modal = openModal({
    title: 'イントロクイズ', content, size: 'md',
    actions: [
      { label: 'キャンセル' },
      { label: 'スタート', primary: true, onClick: () => {
        store.setSetting('quizCount', opts.count);
        store.setSetting('quizSeconds', opts.seconds);
        store.setSetting('quizFrom', opts.from);
        startQuiz(srcs.find(s => s.id === sel.value).items, opts);
      } }
    ]
  });
  startBtn = modal.box.querySelector('.modal-footer .btn-primary');
  updatePool();
}

function ring(cls) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', cls);
  svg.innerHTML = '<circle cx="60" cy="60" r="54" class="q-ring-bg"/><circle cx="60" cy="60" r="54" class="q-ring-fg"/>';
  return svg;
}

export function startQuiz(items, { count = 10, seconds = 5, from = 'start' } = {}) {
  const e = ctx.engine;
  if (!e || !e.ready) { toastError(state.ui.playerError || 'YouTubeプレイヤーの準備ができていません'); return; }
  let questions;
  try { questions = buildQuiz(items, { count }); } catch (err) { toastError(err.message); return; }
  if (game) closeQuiz();
  e.stop();

  const RING = 2 * Math.PI * 54;
  const auroraHost = h('div.q-aurora', { 'aria-hidden': 'true' });
  const dots = h('div.q-dots', ...questions.map(() => h('i')));
  const scoreEl = h('span.q-score-val', '0');
  const comboEl = h('div.q-combo');
  const orbRing = ring('q-ring');
  const ringFg = orbRing.querySelector('.q-ring-fg');
  ringFg.style.strokeDasharray = String(RING);
  const secEl = h('div.q-sec');
  const eq = h('div.q-eq', ...Array.from({ length: 7 }, (_, i) => h('i', { style: { animationDelay: `${i * 0.09}s` } })));
  const backImg = h('img', { alt: '' });
  const backTitle = h('div.q-back-title');
  const backSub = h('div.q-back-sub');
  const card = h('div.q-card',
    h('div.q-face.q-front', orbRing, eq, secEl),
    h('div.q-face.q-back', backImg, h('div.q-back-text', backTitle, backSub)));
  const prompt = h('div.q-prompt');
  const choicesEl = h('div.q-choices');
  const pop = h('div.q-pop');
  const after = h('div.q-after');
  const qnum = h('div.q-num');
  const results = h('section.q-results');
  const play = h('main.q-play', qnum, h('div.q-cardwrap', card, pop), prompt, choicesEl, after);
  const el = h('div.quiz', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'イントロクイズ' },
    auroraHost, h('div.th-vignette'),
    h('header.q-top',
      h('div.q-brand', icon('game'), ' INTRO QUIZ'),
      dots,
      h('div.q-score', h('small', 'SCORE'), scoreEl),
      h('button.th-btn', { type: 'button', title: 'やめる (Esc)', onclick: () => closeQuiz() }, icon('close'))),
    comboEl, play, results);
  document.body.appendChild(el);
  backImg.addEventListener('error', () => { backImg.style.visibility = 'hidden'; });

  const aurora = new Aurora(auroraHost, { particles: 30, intensity: 0.62 });
  aurora.setColors(['#7c5cff', '#ff5c8a', '#2ed3c6']);
  aurora.start({ animate: state.settings.aurora });
  requestAnimationFrame(() => el.classList.add('show'));

  const g = game = {
    el, aurora, questions, i: -1, score: 0, streak: 0, bestStreak: 0, log: [],
    phase: 'idle', t0: 0, timer: 0, loadTimer: 0, offs: [], cur: null
  };

  const setPhase = (p) => { g.phase = p; el.dataset.phase = p; };
  const clearTimers = () => { clearInterval(g.timer); clearTimeout(g.loadTimer); g.timer = 0; g.loadTimer = 0; };

  function updateDots() {
    dots.querySelectorAll('i').forEach((d, k) => {
      const r = g.log[k];
      d.className = k === g.i ? 'now' : r ? (r.skipped ? 'skip' : r.correct ? 'ok' : 'ng') : '';
    });
  }

  function ask(i) {
    clearTimers();
    g.i = i;
    const q = questions[i];
    const song = q.answer.song;
    const start = quizStart(song, from, seconds);
    g.cur = { q, song, start, draft: { ...song, _draft: true, id: `quiz_${song.id}` } };
    setPhase('loading');
    card.classList.remove('flip');
    pop.textContent = '';
    after.replaceChildren();
    comboEl.classList.remove('show');
    qnum.textContent = `Q${i + 1} / ${questions.length}`;
    prompt.textContent = '読み込み中…';
    secEl.textContent = '';
    ringFg.style.strokeDashoffset = '0';
    choicesEl.replaceChildren(...q.choices.map((c, k) => h('button.q-choice', {
      type: 'button', disabled: true, style: { '--k': String(k) }, onclick: () => answer(k)
    }, h('kbd', String(k + 1)), h('span.q-choice-text', h('b', c.song.title), c.song.artist ? h('small', c.song.artist) : null))));
    updateDots();
    play.classList.remove('enter');
    void play.offsetWidth;
    play.classList.add('enter');
    const deck = e.activeDeck;
    const alreadyPlaying = deck && deck.loadedVideoId === song.videoId && deck.state() === 1;
    e.preview(g.cur.draft, start, start + seconds);
    g.loadTimer = setTimeout(() => skip('再生を開始できませんでした'), LOAD_TIMEOUT);
    // 同じ動画が続いて既に再生中のときは「再生開始」イベントが来ないので、シーク後にそのまま始める
    if (alreadyPlaying) setTimeout(() => beginListening(), 300);
  }

  function beginListening() {
    if (g.phase !== 'loading') return;
    clearTimeout(g.loadTimer);
    setPhase('listening');
    prompt.textContent = 'この曲は？';
    choicesEl.querySelectorAll('button').forEach(b => { b.disabled = false; });
    g.t0 = performance.now();
    const limit = (seconds + ANSWER_EXTRA) * 1000;
    g.timer = setInterval(() => {
      const el2 = performance.now() - g.t0;
      const r = Math.min(1, el2 / limit);
      ringFg.style.strokeDashoffset = String(RING * r);
      secEl.textContent = String(Math.max(0, Math.ceil((limit - el2) / 1000)));
      el.classList.toggle('hurry', limit - el2 < 3000);
      if (el2 >= limit) answer(-1);
    }, 100);
  }

  function skip(reason) {
    if (g.phase !== 'loading' && g.phase !== 'listening') return;
    clearTimers();
    g.log[g.i] = { q: g.cur.q, skipped: true, points: 0 };
    toast(`${reason}。この問題はスキップします`, { duration: 2500 });
    next();
  }

  function answer(k) {
    if (g.phase !== 'listening') return;
    clearTimers();
    el.classList.remove('hurry');
    setPhase('reveal');
    const { q, song, start } = g.cur;
    const correctIdx = q.choices.indexOf(q.answer);
    const correct = k === correctIdx;
    const elapsed = performance.now() - g.t0;
    const res = scoreAnswer({ correct, elapsedMs: elapsed, limitMs: (seconds + ANSWER_EXTRA) * 1000, streak: g.streak });
    g.streak = res.streak;
    g.bestStreak = Math.max(g.bestStreak, g.streak);
    g.score += res.points;
    g.log[g.i] = { q, correct, points: res.points, timeout: k < 0, elapsed };
    updateDots();
    animateNumber(scoreEl, g.score);

    const buttons = choicesEl.querySelectorAll('button');
    buttons.forEach((b, j) => {
      b.disabled = true;
      if (j === correctIdx) b.classList.add('correct');
      else if (j === k) b.classList.add('wrong');
      else b.classList.add('dim');
    });
    backImg.style.visibility = '';
    backImg.src = thumbUrl(song.videoId, 'hqdefault');
    backTitle.textContent = song.title;
    backSub.textContent = [song.artist, song.article].filter(Boolean).join(' · ');
    card.classList.add('flip');
    if (correct) {
      prompt.textContent = elapsed < 2000 ? '⚡ 神速！' : '正解！';
      pop.textContent = `+${res.points}`;
      pop.className = 'q-pop show';
      const r = buttons[k].getBoundingClientRect();
      confetti({ x: r.left + r.width / 2, y: r.top, count: g.streak >= 3 ? 110 : 55, spread: 0.8 });
      if (g.streak >= 3) { comboEl.textContent = `🔥 ${g.streak} COMBO!`; comboEl.classList.add('show'); }
      aurora.pulse();
    } else {
      prompt.textContent = k < 0 ? '時間切れ…' : 'ざんねん…';
      pop.className = 'q-pop';
      el.classList.add('shake');
      setTimeout(() => el.classList.remove('shake'), 500);
    }
    // 答え合わせの間は、続きを少し聴けるようにする
    const until = start + seconds + 20;
    if (e.state.status === 'preview') e.previewEnd = until;
    else e.preview(g.cur.draft, Math.max(start, e.state.cur), until);

    const last = g.i >= questions.length - 1;
    after.replaceChildren(
      h('button.btn.btn-ghost', { type: 'button', onclick: (ev) => { actions.enqueue([{ song, playlistId: q.answer.playlistId }]); ev.currentTarget.disabled = true; } }, icon('queue'), ' あとで聴く'),
      h('button.btn.btn-primary.q-next', { type: 'button', onclick: () => next() }, last ? '結果を見る' : '次へ', h('kbd', 'Enter')));
    setTimeout(() => { const n = after.querySelector('.q-next'); n && n.focus(); }, 50);
  }

  function next() {
    if (g.i + 1 < questions.length) ask(g.i + 1);
    else finish();
  }

  function finish() {
    clearTimers();
    setPhase('done');
    e.pause();
    const answered = g.log.filter(r => r && !r.skipped);
    const correctN = answered.filter(r => r.correct).length;
    const ratio = answered.length ? correctN / answered.length : 0;
    const gr = grade(ratio);
    const best = state.settings.quizBest || 0;
    const isBest = g.score > best;
    if (isBest) store.setSetting('quizBest', g.score);
    const scoreBig = h('div.q-res-score', '0');
    const missed = g.log.filter(r => r && !r.skipped && !r.correct).map(r => r.q.answer);
    results.replaceChildren(
      h('div.q-res-grade', gr.label),
      scoreBig,
      isBest ? h('div.q-res-best', '🏆 NEW RECORD!') : h('div.q-res-sub', `ハイスコア ${best.toLocaleString()}`),
      h('p.q-res-msg', gr.msg),
      h('div.q-res-stats',
        h('div', h('b', `${correctN}/${answered.length}`), h('small', '正解')),
        h('div', h('b', `${Math.round(ratio * 100)}%`), h('small', '正答率')),
        h('div', h('b', String(g.bestStreak)), h('small', '最大コンボ'))),
      h('ol.q-res-list', ...g.log.map((r, k) => {
        if (!r) return null;
        const s = r.q.answer.song;
        return h('li', { class: r.skipped ? 'skip' : r.correct ? 'ok' : 'ng' },
          h('span.q-res-mark', r.skipped ? '–' : r.correct ? '✓' : '✗'),
          h('img', { src: thumbUrl(s.videoId, 'default'), alt: '', onerror: (ev) => { ev.target.style.visibility = 'hidden'; } }),
          h('span.q-res-title', h('b', s.title), h('small', s.artist || s.article || '')),
          h('span.q-res-pts', r.points ? `+${r.points}` : ''),
          h('button.th-btn', { type: 'button', title: '再生', onclick: () => { closeQuiz(); actions.playSong(s.id); } }, icon('play')));
      })),
      h('div.q-res-actions',
        h('button.btn.btn-primary', { type: 'button', onclick: () => startQuiz(items, { count, seconds, from }) }, icon('game'), ' もう一度'),
        missed.length ? h('button.btn.btn-ghost', { type: 'button', onclick: () => {
          closeQuiz();
          actions.importSongs(missed.map(it => ({ ...it.song, id: undefined })), { mode: 'new', name: 'クイズで聴き込む曲' });
        } }, icon('library'), ` 間違えた${missed.length}曲をプレイリストに`) : null,
        h('button.btn.btn-ghost', { type: 'button', onclick: () => closeQuiz() }, '閉じる'))
    );
    el.classList.add('finished');
    animateNumber(scoreBig, g.score, 1200);
    if (isBest || ratio >= 0.8) {
      setTimeout(() => { confetti({ x: innerWidth / 2, y: innerHeight * 0.35, count: 160, spread: 1.6 }); }, 500);
    }
  }

  // ----- イベント -----
  g.offs.push(e.on('playing', () => { if (g.phase === 'loading' && e.state.status === 'preview') beginListening(); }));
  g.offs.push(e.on('error', () => skip('この動画は再生できませんでした')));
  const onKey = (ev) => {
    if (!game) return;
    if (hasOpenModal()) return;
    const key = ev.key;
    if (key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); closeQuiz(); return; }
    if (/^[1-4]$/.test(key) && g.phase === 'listening') { ev.preventDefault(); ev.stopImmediatePropagation(); answer(parseInt(key, 10) - 1); return; }
    if ((key === 'Enter' || key === ' ') && g.phase === 'reveal') { ev.preventDefault(); ev.stopImmediatePropagation(); next(); return; }
    if ((key === 'r' || key === 'R') && g.phase === 'listening') {
      ev.preventDefault(); ev.stopImmediatePropagation();
      e.preview(g.cur.draft, g.cur.start, g.cur.start + seconds);
      return;
    }
    // クイズ中は他のショートカット（再生操作など）を止める。Tab・文字入力は通す
    if (key !== 'Tab') { ev.stopImmediatePropagation(); if (key === ' ') ev.preventDefault(); }
  };
  window.addEventListener('keydown', onKey, true);
  g.offs.push(() => window.removeEventListener('keydown', onKey, true));
  g.clearTimers = clearTimers;

  ask(0);
}

export function closeQuiz() {
  const g = game;
  if (!g) return;
  game = null;
  g.clearTimers && g.clearTimers();
  g.offs.forEach(off => off && off());
  if (ctx.engine) ctx.engine.stop();
  g.el.classList.remove('show');
  g.el.classList.add('closing');
  setTimeout(() => { g.aurora.destroy(); g.el.remove(); }, 400);
}

function animateNumber(el, to, ms = 600) {
  const from = parseInt(String(el.textContent).replace(/[^\d]/g, ''), 10) || 0;
  const t0 = performance.now();
  const stepFn = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    const v = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
    el.textContent = v.toLocaleString();
    if (p < 1) requestAnimationFrame(stepFn);
  };
  requestAnimationFrame(stepFn);
}

