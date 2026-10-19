// YouTube IFrame API のモック（テスト用）
// 実際のプレイヤーに近い挙動: ロード後にバッファリング → 再生、時間が進む、
// endSeconds / 動画末尾で ENDED、特定IDでエラー、cue 中の seekTo で再生開始。
// window.__mock = { durations: {videoId: sec}, latency: ms, speed: 倍速 }
(function () {
  const cfg = () => Object.assign({ durations: {}, latency: 150, speed: 1 }, window.__mock || {});
  const instances = [];
  class Player {
    constructor(elId, opts) {
      this.elId = elId;
      this.events = (opts && opts.events) || {};
      this.state = -1;
      this.cur = 0;
      this.dur = 0;
      this.vol = 100;
      this.rate = 1;
      this.videoId = null;
      this.endSeconds = null;
      this.log = [];
      instances.push(this);
      setTimeout(() => this.events.onReady && this.events.onReady({ target: this }), 10);
      this.timer = setInterval(() => this.step(), 50);
    }
    step() {
      if (this.state !== 1) return;
      this.cur += 0.05 * this.rate * cfg().speed;
      if (this.endSeconds != null && this.cur >= this.endSeconds) { this.cur = this.endSeconds; this.setState(0); }
      else if (this.dur && this.cur >= this.dur) { this.cur = this.dur; this.setState(0); }
    }
    setState(s) {
      this.state = s;
      this.log.push([performance.now() | 0, s]);
      this.events.onStateChange && this.events.onStateChange({ data: s, target: this });
    }
    load(p, auto) {
      const { videoId, startSeconds = 0, endSeconds = null } = p;
      this.videoId = videoId;
      this.dur = cfg().durations[videoId] ?? 300;
      this.cur = startSeconds;
      this.endSeconds = endSeconds;
      this.log.push(['load', videoId, startSeconds, endSeconds, auto]);
      if (/^ERR/.test(videoId)) { setTimeout(() => this.events.onError && this.events.onError({ data: 100, target: this }), 50); return; }
      this.setState(-1);
      if (auto) {
        this.setState(3);
        setTimeout(() => { if (this.videoId === videoId && this.state === 3) this.setState(1); }, cfg().latency);
      } else {
        setTimeout(() => { if (this.videoId === videoId) this.setState(5); }, 30);
      }
    }
    loadVideoById(p) { this.load(p, true); }
    cueVideoById(p) { this.load(p, false); }
    playVideo() {
      if (!this.videoId || this.state === 1) return;
      this.setState(3);
      setTimeout(() => { if (this.state === 3) this.setState(1); }, 60);
    }
    pauseVideo() { if (this.state === 1 || this.state === 3) this.setState(2); }
    stopVideo() { this.videoId = null; this.cur = 0; this.endSeconds = null; this.setState(-1); }
    seekTo(s) { this.cur = s; if (this.state === 5 || this.state === 0) this.playVideo(); }
    getCurrentTime() { return this.cur; }
    getDuration() { return this.dur; }
    getPlayerState() { return this.state; }
    setVolume(v) { this.vol = v; }
    getVolume() { return this.vol; }
    mute() {} unMute() {}
    setPlaybackRate(r) { this.rate = r; }
    getAvailablePlaybackRates() { return [0.5, 1, 1.5, 2]; }
    getVideoLoadedFraction() { return 1; }
    getVideoData() { return { video_id: this.videoId, title: 'mock ' + this.videoId, author: 'mock' }; }
    destroy() { clearInterval(this.timer); }
  }
  window.YT = { Player, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };
  window.__ytMockInstances = instances;
})();
