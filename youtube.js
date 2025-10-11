// youtube.js
// YouTubeプレイヤーAPI管理モジュール

let ytPlayer = null;
let ytReady = false;
let playerReadyCallback = null;
let fadeAnimationId = null;
let currentVolume = 100;

export function loadYouTubeAPI(onReadyCallback) {
  if (window.YT && window.YT.Player) {
    // すでにAPIロード済み
    onYouTubeIframeAPIReady();
    if (onReadyCallback) onReadyCallback();
    return;
  }
  playerReadyCallback = onReadyCallback;
  const tag = document.createElement('script');
  tag.src = "https://www.youtube.com/iframe_api";
  document.body.appendChild(tag);
  window.onYouTubeIframeAPIReady = function () {
    onYouTubeIframeAPIReady();
    if (playerReadyCallback) playerReadyCallback();
  };
}

// YouTube IFrame API のPlayerインスタンス生成
function onYouTubeIframeAPIReady() {
  if (ytPlayer) return;
  ytPlayer = new YT.Player('ytPlayer', {
    height: '540',
    width: '100%',
    videoId: '',
    events: {
      'onReady': () => { ytReady = true; },
      'onStateChange': (event) => {
        if (typeof window.onYouTubePlayerStateChange === 'function') {
          window.onYouTubePlayerStateChange(event);
        }
      }
    },
    playerVars: {
      'controls': 1,
      'modestbranding': 1,
      'rel': 0
    }
  });
}

// 動画再生（フェードイン対応）
export function setVideo({ videoId, seekSec = 0, endSec = null, autoPlay = true, fadeIn = true }) {
  if (!ytPlayer) return;
  
  if (fadeIn) {
    // フェードイン開始
    ytPlayer.setVolume(0);
    ytPlayer.loadVideoById({ videoId, startSeconds: seekSec || 0 });
    if (autoPlay) {
      ytPlayer.playVideo();
      fadeVolume(0, currentVolume, 1000); // 1秒でフェードイン
    }
  } else {
    ytPlayer.loadVideoById({ videoId, startSeconds: seekSec || 0 });
    if (autoPlay) ytPlayer.playVideo();
  }
}

// フェードアウト付き停止
export function fadeOutAndStop(duration = 800) {
  return new Promise((resolve) => {
    const startVolume = ytPlayer.getVolume();
    fadeVolume(startVolume, 0, duration, () => {
      pauseVideo();
      ytPlayer.setVolume(currentVolume); // 元の音量に戻す
      resolve();
    });
  });
}

// 音量フェード関数
function fadeVolume(fromVolume, toVolume, duration, onComplete) {
  if (fadeAnimationId) {
    cancelAnimationFrame(fadeAnimationId);
  }
  
  const startTime = performance.now();
  const volumeDiff = toVolume - fromVolume;
  
  function animate(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // イーズアウト効果
    const easedProgress = 1 - Math.pow(1 - progress, 3);
    const currentVol = fromVolume + (volumeDiff * easedProgress);
    
    if (ytPlayer && ytPlayer.setVolume) {
      ytPlayer.setVolume(Math.round(currentVol));
    }
    
    if (progress < 1) {
      fadeAnimationId = requestAnimationFrame(animate);
    } else {
      fadeAnimationId = null;
      if (onComplete) onComplete();
    }
  }
  
  fadeAnimationId = requestAnimationFrame(animate);
}

// 再生・一時停止・停止
export function playVideo()  { ytPlayer && ytPlayer.playVideo && ytPlayer.playVideo(); }
export function pauseVideo() { ytPlayer && ytPlayer.pauseVideo && ytPlayer.pauseVideo(); }
export function stopVideo()  { ytPlayer && ytPlayer.stopVideo && ytPlayer.stopVideo(); }
export function seekTo(sec)  { ytPlayer && ytPlayer.seekTo && ytPlayer.seekTo(sec, true); }
export function getCurrentTime() { return ytPlayer && ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0; }
export function getPlayerState()  { return ytPlayer && ytPlayer.getPlayerState ? ytPlayer.getPlayerState() : -1; }
export function setVolume(volume) { 
  currentVolume = volume;
  if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(volume); 
}
export function getVolume() { return ytPlayer && ytPlayer.getVolume ? ytPlayer.getVolume() : currentVolume; }

// 動画タイトル取得（改良版：エラーハンドリング改善）
export async function fetchYouTubeTitle(videoId) {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`YouTubeタイトル取得失敗（HTTP ${res.status}）`);
      return "";
    }
    const data = await res.json();
    return data.title || "";
  } catch (err) {
    console.error("YouTubeタイトル取得時にネットワークエラーが発生しました:", err.message);
    return "";
  }
}

// プレイヤー状態変更イベント用（windowグローバルに割当）
export function setPlayerStateChangeCallback(fn) {
  window.onYouTubePlayerStateChange = fn;
}

