// 再生エンジン（2デッキ構成）
//
// - デッキA/Bの2つの YouTube プレイヤーを持ち、次の曲を裏のデッキで先読みして
//   区間終了の crossfade 秒前からクロスフェードで切り替える（曲間の無音・黒画面を無くす）
// - 世代トークン: 曲切替・停止のたびに増やし、古いタイマー・コールバックを無効化する
// - 区間終了の監視は setInterval（バックグラウンドタブでも止まらない）
// - endSeconds もプレイヤーに渡し、JS が止まっても必ず区間で止まる二重の保険
// - 「次に再生」キュー、シャッフル、リピート、再生速度、試聴（プレビュー）に対応

import { Deck, STATE, ERROR_MESSAGES, loadAPI } from './yt.js';
import { hasValidEnd } from '../core/model.js';

const PRELOAD_LEAD = 8;       // 区間終了の何秒前から先読みを始めるか
const END_EPSILON = 0.3;      // クロスフェード無しのときの終了判定の余裕
const SEEK_PAST_END_SLACK = 1.5;

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Engine {
  constructor({ deckIds, stageEl }) {
    this.deckIds = deckIds;
    this.stageEl = stageEl;
    this.decks = [];
    this.active = 0;
    this.token = 0;
    this.listeners = new Map();
    this.ready = false;
    this.apiError = '';

    this.state = {
      status: 'idle',       // idle | loading | playing | paused | preview | error
      song: null,           // 現在の曲（プレイリスト内の実オブジェクト or 編集中ドラフト）
      playlistId: null,
      context: [],          // [{song, playlistId}]
      order: [],            // context のインデックス列（再生順）
      pos: -1,
      queue: [],            // 「次に再生」 [{song, playlistId}]
      repeat: 'all',
      shuffle: false,
      volume: 100,
      muted: false,
      rate: 1,
      crossfade: 1.5,
      gapless: true,
      cur: 0,
      duration: 0,
      endDisabled: false
    };

    this.ticker = null;
    this.preloaded = null;      // {songId, videoId, deck, ready, token}
    this.pendingFadeIn = -1;    // 再生開始時にフェードインするトークン
    this.startVerified = -1;
    this.lastStartAt = 0;
    this.transitioning = false;
    this.consecutiveErrors = 0;
    this.previewEnd = null;
    this.free = false;          // 編集用の自由再生モード（自動終了・自動遷移なし）
    this.lastTickCur = 0;       // 直前のティックで観測した再生位置（ENDED がシークによるものか判定する）
    this.lastSeekTarget = null;
    this.lastSeekAt = 0;
  }

  // ===== イベント =====
  on(evt, fn) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt).add(fn);
    return () => this.listeners.get(evt).delete(fn);
  }
  emit(evt, payload) {
    const set = this.listeners.get(evt);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try { fn(payload); } catch (e) { console.error(`engine listener(${evt})`, e); }
    }
  }
  changed() { this.emit('change', this.state); }

  // ===== 初期化 =====
  async init() {
    try {
      await loadAPI();
    } catch (e) {
      this.apiError = e.message;
      this.emit('apierror', e.message);
      throw e;
    }
    await Promise.all(this.deckIds.map((id, i) => new Promise(resolve => {
      this.decks[i] = new Deck(id, {
        onReady: () => resolve(),
        onState: (s, deck) => this.onDeckState(s, deck),
        onError: (code, deck) => this.onDeckError(code, deck)
      });
    })));
    this.ready = true;
    this.showDeck(0);
    this.applyVolume();
    this.emit('ready');
  }

  get activeDeck() { return this.decks[this.active]; }
  get otherDeck() { return this.decks[1 - this.active]; }

  showDeck(i) {
    this.active = i;
    this.decks.forEach((d, idx) => {
      const el = document.getElementById(d.id);
      const wrap = el && el.closest('.deck');
      if (wrap) wrap.classList.toggle('active', idx === i);
    });
  }

  effectiveVolume() { return this.state.muted ? 0 : this.state.volume; }
  applyVolume() {
    const v = this.effectiveVolume();
    if (this.activeDeck && !this.transitioning) this.activeDeck.setVolume(v);
  }

  // ===== コンテキスト（再生対象のリスト）=====
  setContext(items, startSongId, { play = true } = {}) {
    this.state.context = items.slice();
    this.rebuildOrder(startSongId);
    if (play) {
      const idx = this.state.order[this.state.pos];
      if (idx != null) return this.playItem(this.state.context[idx]);
    }
    this.changed();
  }

  rebuildOrder(startSongId) {
    const ctx = this.state.context;
    const startIdx = Math.max(0, ctx.findIndex(it => it.song.id === startSongId));
    if (this.state.shuffle) {
      const rest = ctx.map((_, i) => i).filter(i => i !== startIdx);
      this.state.order = [startIdx, ...shuffleArray(rest)];
      this.state.pos = 0;
    } else {
      this.state.order = ctx.map((_, i) => i);
      this.state.pos = startIdx;
    }
  }

  // プレイリスト編集後に、再生中の順序を壊さずに同期する
  syncContext(items) {
    const ctx = this.state.context;
    if (!ctx.length) return;
    const currentId = this.state.song ? this.state.song.id : null;
    const oldIds = this.state.order.map(i => ctx[i] && ctx[i].song.id).filter(Boolean);
    const newMap = new Map(items.map((it, i) => [it.song.id, i]));
    this.state.context = items.slice();
    if (this.state.shuffle) {
      let order = oldIds.filter(id => newMap.has(id)).map(id => newMap.get(id));
      const known = new Set(order);
      const fresh = items.map((_, i) => i).filter(i => !known.has(i));
      const curPos = currentId ? order.findIndex(i => items[i].song.id === currentId) : -1;
      for (const f of shuffleArray(fresh)) {
        const at = curPos + 1 + Math.floor(Math.random() * (order.length - curPos));
        order.splice(Math.min(at, order.length), 0, f);
      }
      this.state.order = order;
      this.state.pos = currentId ? order.findIndex(i => items[i].song.id === currentId) : -1;
    } else {
      this.state.order = items.map((_, i) => i);
      this.state.pos = currentId ? items.findIndex(it => it.song.id === currentId) : -1;
    }
    // 先読み済みの曲が「次の曲」でなくなっていれば破棄
    const next = this.peekNext();
    if (this.preloaded && (!next || next.item.song.id !== this.preloaded.songId)) this.discardPreload();
    this.changed();
  }

  // 次に再生される曲（消費しない）
  peekNext() {
    if (this.state.queue.length) return { item: this.state.queue[0], from: 'queue' };
    if (this.state.repeat === 'one' && this.state.song) {
      return { item: { song: this.state.song, playlistId: this.state.playlistId }, from: 'repeat' };
    }
    const { order, pos, context, repeat } = this.state;
    if (!order.length) return null;
    let nextPos = pos + 1;
    if (nextPos >= order.length) {
      if (repeat !== 'all') return null;
      nextPos = 0;
    }
    const item = context[order[nextPos]];
    return item ? { item, pos: nextPos, from: 'order' } : null;
  }

  upcoming(limit = 50) {
    const out = [];
    for (const it of this.state.queue) out.push({ ...it, fromQueue: true });
    const { order, pos, context, repeat } = this.state;
    if (order.length) {
      let p = pos + 1;
      let wrapped = false;
      while (out.length < limit) {
        if (p >= order.length) {
          if (repeat !== 'all' || wrapped) break;
          p = 0; wrapped = true;
          if (p === pos + 1) break;
        }
        if (p === pos && wrapped) break;
        const it = context[order[p]];
        if (it) out.push(it);
        p++;
      }
    }
    return out;
  }

  enqueue(items, { next = false } = {}) {
    if (next) this.state.queue.unshift(...items);
    else this.state.queue.push(...items);
    this.discardPreload();
    this.changed();
  }
  removeFromQueue(index) {
    this.state.queue.splice(index, 1);
    this.discardPreload();
    this.changed();
  }
  clearQueue() { this.state.queue = []; this.discardPreload(); this.changed(); }

  // ===== 再生制御 =====
  async playItem(item, { viaAdvance = false } = {}) {
    if (!this.ready || !item || !item.song) return;
    const token = ++this.token;
    const song = item.song;
    this.clearTimers();
    this.free = false;
    this.previewEnd = null;
    this.state.endDisabled = false;
    this.state.song = song;
    this.state.playlistId = item.playlistId || null;
    this.state.status = 'loading';
    this.state.cur = song.start;
    this.lastTickCur = song.start;
    this.lastSeekTarget = null;
    this.lastStartAt = performance.now();
    this.startVerified = -1;
    this.changed();

    const pre = this.preloaded;
    const canCrossfade = pre && pre.songId === song.id && pre.videoId === song.videoId && pre.ready && pre.deck !== this.activeDeck;

    if (canCrossfade) {
      // --- 先読み済み: クロスフェード ---
      const oldDeck = this.activeDeck;
      const newDeck = pre.deck;
      this.preloaded = null;
      this.transitioning = true;
      this.showDeck(this.decks.indexOf(newDeck));
      newDeck.setVolume(0);
      newDeck.seek(song.start);
      newDeck.play();
      newDeck.setRate(this.state.rate);
      const ms = this.state.crossfade * 1000;
      this.startTicker();
      this.emit('songstart', { song, playlistId: this.state.playlistId, viaAdvance });
      await Promise.all([
        newDeck.fade(0, this.effectiveVolume(), ms),
        oldDeck.fade(oldDeck.volume, 0, ms)
      ]);
      this.transitioning = false;
      if (token !== this.token) return;
      oldDeck.stop();
      this.applyVolume();
      return;
    }

    // --- 通常ロード: いまのデッキでフェードアウト → 読み込み → 再生開始時にフェードイン ---
    this.discardPreload();
    if (this.otherDeck) this.otherDeck.stop(); // クロスフェード途中で選び直された場合の残り音を止める
    const deck = this.activeDeck;
    if (deck.state() === STATE.PLAYING && deck.volume > 0) {
      await deck.fade(deck.volume, 0, Math.min(350, Math.max(120, this.state.crossfade * 250)));
      if (token !== this.token) return;
    }
    this.transitioning = false;
    deck.setVolume(0);
    this.pendingFadeIn = token;
    deck.load({ videoId: song.videoId, start: song.start, end: hasValidEnd(song) ? song.end : null, autoplay: true });
    this.startTicker();
    this.emit('songstart', { song, playlistId: this.state.playlistId, viaAdvance });
  }

  playSongInContext(songId) {
    const idx = this.state.context.findIndex(it => it.song.id === songId);
    if (idx < 0) return false;
    const p = this.state.order.indexOf(idx);
    if (p >= 0) this.state.pos = p;
    return this.playItem(this.state.context[idx]);
  }

  // 次の曲へ（タイマー・ENDED・ボタンのいずれからも、トークンを消費して一度だけ）
  advance(token = this.token, { manual = false } = {}) {
    if (token !== this.token) return;
    this.token++;
    const next = this.peekNext();
    if (!next) {
      if (manual && this.state.order.length) {
        // リピートOFFで末尾: 手動なら先頭へ
        this.state.pos = 0;
        return this.playItem(this.state.context[this.state.order[0]]);
      }
      this.finish();
      return;
    }
    if (next.from === 'queue') this.state.queue.shift();
    else if (next.from === 'order') this.state.pos = next.pos;
    return this.playItem(next.item, { viaAdvance: !manual });
  }

  next() { return this.advance(this.token, { manual: true }); }

  prev() {
    const song = this.state.song;
    const elapsed = song ? this.state.cur - song.start : 0;
    if (song && elapsed > 3) {
      // 3秒以上経っていれば曲の先頭へ
      return this.playItem({ song, playlistId: this.state.playlistId });
    }
    const { order, context } = this.state;
    if (!order.length) return;
    let p = this.state.pos - 1;
    if (p < 0) p = this.state.repeat === 'all' ? order.length - 1 : 0;
    this.state.pos = p;
    return this.playItem(context[order[p]]);
  }

  finish() {
    this.clearTimers();
    this.discardPreload();
    this.activeDeck.pause();
    this.state.status = 'idle';
    this.changed();
    this.emit('finish');
  }

  stop() {
    this.token++;
    this.clearTimers();
    this.discardPreload();
    this.decks.forEach(d => { d.cancelFade(); d.stop(); });
    this.transitioning = false;
    this.state.status = 'idle';
    this.state.song = null;
    this.state.playlistId = null;
    this.state.cur = 0;
    this.state.duration = 0;
    this.changed();
  }

  togglePlay() {
    if (!this.ready) return;
    const st = this.state.status;
    if (st === 'playing' || st === 'preview') { this.activeDeck.pause(); return; }
    if (st === 'paused' || st === 'loading') { this.activeDeck.play(); return; }
    if (st === 'idle' && this.state.song) {
      // 最後まで再生して止まった状態 → その曲を最初から
      return this.playItem({ song: this.state.song, playlistId: this.state.playlistId });
    }
    if (this.state.context.length) {
      const idx = this.state.order[Math.max(0, this.state.pos)] ?? 0;
      return this.playItem(this.state.context[idx]);
    }
  }
  pause() { this.activeDeck && this.activeDeck.pause(); }
  play() { this.activeDeck && this.activeDeck.play(); }

  // 動画内の絶対秒へシーク
  seek(sec) {
    if (!this.ready) return;
    sec = Math.max(0, sec);
    const song = this.state.song;
    this.lastSeekTarget = sec;
    this.lastSeekAt = performance.now();
    if (song && !this.free && hasValidEnd(song) && !this.state.endDisabled && sec > song.end + SEEK_PAST_END_SLACK) {
      this.disableAutoEnd();
    }
    this.activeDeck.seek(sec);
    this.state.cur = sec;
    this.lastTickCur = sec;
    this.emitTick();
  }

  // この曲に限り自動終了を解除（終了位置を越えてシークしたとき）
  disableAutoEnd() {
    if (this.state.endDisabled) return;
    this.state.endDisabled = true;
    this.discardPreload();
    this.changed();
    this.emit('notice', '終了位置を越えてシークしたため、自動終了を解除しました');
  }

  // 区間内の割合（0..1）へシーク
  seekRatio(r) {
    const song = this.state.song;
    if (!song) return;
    const end = hasValidEnd(song) ? song.end : this.state.duration;
    if (!(end > song.start)) return;
    this.seek(song.start + Math.max(0, Math.min(1, r)) * (end - song.start));
  }

  seekBy(delta) {
    this.seek(Math.max(0, this.state.cur + delta));
  }

  // ===== モード =====
  setRepeat(mode) { this.state.repeat = mode; this.discardPreload(); this.changed(); }
  setShuffle(on) {
    this.state.shuffle = !!on;
    if (this.state.context.length) {
      const cur = this.state.song ? this.state.song.id : null;
      this.rebuildOrder(cur);
      if (!this.state.shuffle && cur) {
        this.state.pos = this.state.context.findIndex(it => it.song.id === cur);
      }
    }
    this.discardPreload();
    this.changed();
  }
  setVolume(v) { this.state.volume = Math.max(0, Math.min(100, v)); if (v > 0) this.state.muted = false; this.applyVolume(); this.changed(); }
  setMuted(m) { this.state.muted = !!m; this.applyVolume(); this.changed(); }
  setRate(r) { this.state.rate = r; this.activeDeck && this.activeDeck.setRate(r); this.changed(); }
  setCrossfade(sec) { this.state.crossfade = Math.max(0, Math.min(8, sec)); this.changed(); }
  setGapless(on) { this.state.gapless = !!on; if (!on) this.discardPreload(); this.changed(); }

  // ===== 編集支援 =====
  // 自由再生モード: 区間の自動終了・自動遷移をせず、ドラフトの動画を読み込む
  loadForEdit(draft, { autoplay = false } = {}) {
    if (!this.ready || !draft || !draft.videoId) return;
    this.token++;
    this.clearTimers();
    this.discardPreload();
    this.free = true;
    this.previewEnd = null;
    this.state.song = draft;
    this.state.playlistId = null;
    this.state.endDisabled = true;
    const deck = this.activeDeck;
    deck.cancelFade();
    deck.setVolume(this.effectiveVolume());
    if (deck.loadedVideoId === draft.videoId) {
      deck.seek(draft.start || 0);
      if (autoplay) deck.play();
    } else {
      deck.load({ videoId: draft.videoId, start: draft.start || 0, end: null, autoplay });
    }
    this.state.status = autoplay ? 'loading' : 'paused';
    this.startTicker();
    this.changed();
  }

  // 試聴: from〜to を再生して止まる（編集中の開始・終了の確認用）
  preview(draft, from, to) {
    if (!this.ready || !draft || !draft.videoId) return;
    this.token++;
    this.clearTimers();
    this.discardPreload();
    this.free = true;
    this.state.song = draft;
    this.state.playlistId = null;
    this.state.endDisabled = true;
    this.previewEnd = to;
    const deck = this.activeDeck;
    deck.cancelFade();
    deck.setVolume(this.effectiveVolume());
    if (deck.loadedVideoId === draft.videoId) {
      deck.seek(Math.max(0, from));
      deck.play();
    } else {
      deck.load({ videoId: draft.videoId, start: Math.max(0, from), end: null, autoplay: true });
    }
    this.state.status = 'preview';
    this.startTicker();
    this.changed();
  }

  // ===== デッキのイベント =====
  onDeckState(s, deck) {
    const pre = this.preloaded;
    if (pre && deck === pre.deck && deck !== this.activeDeck) {
      // 先読みデッキ: 再生が始まったら即一時停止して頭出し状態で待機
      if (s === STATE.PLAYING && !pre.ready) {
        deck.pause();
        deck.seek(pre.start);
        pre.ready = true;
      }
      return;
    }
    if (deck !== this.activeDeck) return;

    if (s === STATE.PLAYING) {
      this.consecutiveErrors = 0;
      if (this.state.status === 'preview') { /* keep */ }
      else this.state.status = 'playing';
      if (this.pendingFadeIn === this.token) {
        this.pendingFadeIn = -1;
        deck.fade(0, this.effectiveVolume(), 700);
      } else if (!this.transitioning) {
        deck.setVolume(this.effectiveVolume());
      }
      deck.setRate(this.state.rate);
      const song = this.state.song;
      if (song && !this.free && this.startVerified !== this.token) {
        // 開始位置の検証（世代ごとに1回）: 実際に再生が始まった時点でずれていたら補正
        this.startVerified = this.token;
        const cur = deck.currentTime();
        if (Math.abs(cur - song.start) > 2) deck.seek(song.start);
      }
      this.state.duration = deck.duration() || this.state.duration;
      this.changed();
      this.emit('playing');
    } else if (s === STATE.PAUSED) {
      if (this.state.status !== 'idle') this.state.status = 'paused';
      this.changed();
    } else if (s === STATE.BUFFERING) {
      if (this.state.status === 'idle') this.state.status = 'loading';
      this.changed();
    } else if (s === STATE.ENDED) {
      if (this.free) { this.state.status = 'paused'; this.changed(); return; }
      // 曲切替直後に届く ENDED は前の動画のもの（二重スキップ防止）。
      // ただしプレイヤーが実際に区間の終端にいるなら本物なので無視しない。
      const song = this.state.song;
      const cur = deck.currentTime();
      const atEnd = song && hasValidEnd(song)
        ? Math.abs(cur - song.end) < 1
        : (deck.duration() > 0 && cur >= deck.duration() - 1);
      if (performance.now() - this.lastStartAt < 1000 && !atEnd) return;
      if (this.resumePastEndIfSeeked(deck)) return;
      this.advance(this.token);
    } else if (s === STATE.CUED) {
      if (this.free) { this.state.status = 'paused'; this.state.duration = deck.duration() || 0; this.changed(); }
    }
  }

  // endSeconds を渡したプレイヤーは、終了位置より先へシークした瞬間に ENDED を出すことがある。
  // 直前の再生位置から大きく飛んで終了した（= シークで到達した）場合は「自動終了の解除」として扱い、
  // endSeconds なしで読み込み直して続きを再生する。自然に終わった場合は false を返す。
  resumePastEndIfSeeked(deck) {
    const song = this.state.song;
    if (!song || !hasValidEnd(song)) return false;
    const recentSeek = this.lastSeekTarget != null && performance.now() - this.lastSeekAt < 1500;
    // バックグラウンドではタイマーが間引かれ lastTickCur が古くなるため、画面表示中のみ「飛び」を判定する
    const jumped = document.visibilityState === 'visible' && (song.end - this.lastTickCur) > 3;
    if (!this.state.endDisabled && !recentSeek && !jumped) return false;
    const dur = deck.duration() || this.state.duration;
    const target = recentSeek ? this.lastSeekTarget : Math.max(deck.currentTime(), song.end);
    if (dur > 0 && target >= dur - 1) return false; // 動画の実際の最後 → 通常どおり次へ
    this.disableAutoEnd();
    this.lastStartAt = performance.now();
    this.lastSeekTarget = null;
    deck.setVolume(this.effectiveVolume());
    deck.load({ videoId: song.videoId, start: target, end: null, autoplay: true });
    this.state.status = 'loading';
    this.changed();
    return true;
  }

  onDeckError(code, deck) {
    const message = ERROR_MESSAGES[code] || `再生エラー (code: ${code})`;
    if (this.preloaded && deck === this.preloaded.deck && deck !== this.activeDeck) {
      // 先読みに失敗 → 通常ロードにフォールバック（実際の再生時に再度エラーなら通知）
      this.discardPreload();
      return;
    }
    if (deck !== this.activeDeck) return;
    this.consecutiveErrors++;
    this.clearTimers();
    this.state.status = 'error';
    this.changed();
    const song = this.state.song;
    this.emit('error', { code, message, song });
    if (!this.free && song && this.consecutiveErrors < 5 && this.state.context.length > 1) {
      const token = this.token;
      setTimeout(() => this.advance(token), 1800);
    }
  }

  // ===== タイマー =====
  startTicker() {
    this.stopTicker();
    this.ticker = setInterval(() => this.tick(), 250);
  }
  stopTicker() { if (this.ticker) { clearInterval(this.ticker); this.ticker = null; } }
  clearTimers() {
    this.stopTicker();
    this.pendingFadeIn = -1;
    this.decks.forEach(d => d && d.cancelFade());
  }

  emitTick() {
    const song = this.state.song;
    this.emit('tick', {
      cur: this.state.cur,
      duration: this.state.duration,
      segStart: song ? song.start : 0,
      segEnd: song && hasValidEnd(song) ? song.end : this.state.duration,
      status: this.state.status
    });
  }

  tick() {
    const deck = this.activeDeck;
    if (!deck) return;
    const token = this.token;
    const st = deck.state();
    this.state.cur = deck.currentTime();
    const d = deck.duration();
    if (d > 0) this.state.duration = d;
    this.emitTick();

    if (st !== STATE.PLAYING) return;
    this.lastTickCur = this.state.cur;

    // 試聴の終了
    if (this.previewEnd != null) {
      if (this.state.cur >= this.previewEnd) {
        this.previewEnd = null;
        deck.pause();
        this.state.status = 'paused';
        this.changed();
        this.emit('previewend');
      }
      return;
    }
    if (this.free) return;

    const song = this.state.song;
    if (!song) return;
    const end = hasValidEnd(song) ? song.end : (this.state.duration || 0);
    if (!(end > 0)) return;
    const cur = this.state.cur;

    if (hasValidEnd(song) && !this.state.endDisabled && cur > end + SEEK_PAST_END_SLACK) {
      // ユーザーがプレイヤー側のバーで終了位置より先へシークした → この曲に限り自動終了を解除
      this.disableAutoEnd();
      return;
    }
    if (this.state.endDisabled) return;

    const remaining = end - cur;
    const lead = this.state.crossfade > 0 ? this.state.crossfade : END_EPSILON;

    if (this.state.gapless && remaining <= PRELOAD_LEAD && !this.preloaded && !this.transitioning) {
      this.preloadNext();
    }
    if (remaining <= lead) {
      this.advance(token);
    }
  }

  // ===== 先読み =====
  preloadNext() {
    const next = this.peekNext();
    if (!next || !next.item || !next.item.song) return;
    const deck = this.otherDeck;
    if (!deck || !deck.ready) return;
    const song = next.item.song;
    deck.cancelFade();
    deck.setVolume(0);
    deck.load({ videoId: song.videoId, start: song.start, end: hasValidEnd(song) ? song.end : null, autoplay: true });
    this.preloaded = { songId: song.id, videoId: song.videoId, start: song.start, deck, ready: false };
  }

  discardPreload() {
    const pre = this.preloaded;
    if (!pre) return;
    this.preloaded = null;
    if (pre.deck && pre.deck !== this.activeDeck) pre.deck.stop();
  }

  // ===== 情報 =====
  videoData() { return this.activeDeck ? this.activeDeck.videoData() : null; }
  currentTime() { return this.state.cur; }
  duration() { return this.state.duration; }
}
