// YouTube IFrame API のラッパー
// 「デッキ」= 1つの YT.Player。エンジンは2つのデッキを使って先読み・クロスフェードする。

let apiPromise = null;

export function loadAPI({ timeout = 15000 } = {}) {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) { resolve(window.YT); return; }
    const prev = window.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => reject(new Error('YouTube API の読み込みがタイムアウトしました')), timeout);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      if (typeof prev === 'function') { try { prev(); } catch { /* ignore */ } }
      resolve(window.YT);
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.onerror = () => { clearTimeout(timer); reject(new Error('YouTube API を読み込めませんでした（ネットワークを確認してください）')); };
    document.head.appendChild(tag);
  });
  apiPromise.catch(() => { apiPromise = null; });
  return apiPromise;
}

export const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

export const ERROR_MESSAGES = {
  2: '動画IDが正しくありません',
  5: 'プレイヤーでエラーが発生しました',
  100: '動画が見つかりません（削除または非公開）',
  101: 'この動画は埋め込み再生が許可されていません',
  150: 'この動画は埋め込み再生が許可されていません'
};

export class Deck {
  constructor(elementId, { onState, onError, onReady } = {}) {
    this.id = elementId;
    this.player = null;
    this.ready = false;
    this.volume = 100;
    this.fadeTimer = null;
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
    this.onReadyCb = onReady || (() => {});
    this.loadedVideoId = null;
    const playerVars = { controls: 1, rel: 0, playsinline: 1, iv_load_policy: 3 };
    if (/^https?:/.test(location.origin)) playerVars.origin = location.origin;
    this.player = new window.YT.Player(elementId, {
      width: '100%',
      height: '100%',
      videoId: '',
      playerVars,
      events: {
        onReady: () => { this.ready = true; this.onReadyCb(this); },
        onStateChange: (e) => this.onState(e.data, this),
        onError: (e) => this.onError(e.data, this)
      }
    });
  }

  call(name, ...args) {
    const p = this.player;
    if (!this.ready || !p || typeof p[name] !== 'function') return undefined;
    try { return p[name](...args); } catch (e) { console.warn(`YT.${name} failed`, e); return undefined; }
  }

  load({ videoId, start = 0, end = null, autoplay = true }) {
    this.loadedVideoId = videoId;
    const params = { videoId, startSeconds: start || 0 };
    if (end && end > (start || 0)) params.endSeconds = end;
    if (autoplay) this.call('loadVideoById', params);
    else this.call('cueVideoById', params);
  }

  play() { this.call('playVideo'); }
  pause() { this.call('pauseVideo'); }
  stop() { this.call('stopVideo'); this.loadedVideoId = null; }
  seek(sec) { this.call('seekTo', Math.max(0, sec), true); }
  mute() { this.call('mute'); }
  unmute() { this.call('unMute'); }
  currentTime() { return this.call('getCurrentTime') || 0; }
  duration() { return this.call('getDuration') || 0; }
  state() { const s = this.call('getPlayerState'); return s == null ? STATE.UNSTARTED : s; }
  videoData() { return this.call('getVideoData') || null; }
  setRate(rate) { this.call('setPlaybackRate', rate); }
  availableRates() { return this.call('getAvailablePlaybackRates') || [1]; }
  loadedFraction() { return this.call('getVideoLoadedFraction') || 0; }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(100, Math.round(v)));
    this.call('setVolume', this.volume);
  }

  cancelFade() {
    if (this.fadeTimer) { clearInterval(this.fadeTimer); this.fadeTimer = null; }
  }

  // 音量を from → to へ duration ミリ秒で変化させる（setInterval: バックグラウンドでも動く）
  fade(from, to, duration) {
    this.cancelFade();
    return new Promise(resolve => {
      if (duration <= 0) { this.setVolume(to); resolve(); return; }
      const t0 = performance.now();
      this.setVolume(from);
      this.fadeTimer = setInterval(() => {
        const p = Math.min(1, (performance.now() - t0) / duration);
        const eased = to > from ? 1 - Math.pow(1 - p, 2) : 1 - Math.pow(1 - p, 3);
        this.setVolume(from + (to - from) * eased);
        if (p >= 1) { this.cancelFade(); resolve(); }
      }, 50);
    });
  }

  destroy() {
    this.cancelFade();
    try { this.player && this.player.destroy(); } catch { /* ignore */ }
    this.player = null;
    this.ready = false;
  }
}

// oEmbed で動画情報（タイトル・チャンネル名）を取得。APIキー不要。
export async function fetchVideoInfo(videoId) {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + videoId)}&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`oEmbed HTTP ${res.status}`);
  const d = await res.json();
  return { title: d.title || '', author: d.author_name || '', thumbnail: d.thumbnail_url || '' };
}
