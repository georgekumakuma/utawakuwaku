// youtube.js
// YouTubeプレイヤーAPI管理モジュール

let ytPlayer = null;
let ytReady = false;
let playerReadyCallback = null;

export function loadYouTubeAPI(onReadyCallback) {
  if (window.YT && window.YT.Player) {
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

// 動画再生（フェード時は volume を 0 にしてから呼び出す）
export function setVideo({ videoId, seekSec = 0, endSec = null, autoPlay = true }) {
  if (!ytPlayer) return;
  ytPlayer.loadVideoById({ videoId, startSeconds: seekSec || 0 });
  if (autoPlay) ytPlayer.playVideo();
}

// 再生・一時停止・停止・シーク
export function playVideo()  { ytPlayer && ytPlayer.playVideo && ytPlayer.playVideo(); }
export function pauseVideo() { ytPlayer && ytPlayer.pauseVideo && ytPlayer.pauseVideo(); }
export function stopVideo()  { ytPlayer && ytPlayer.stopVideo && ytPlayer.stopVideo(); }
export function seekTo(sec)  { ytPlayer && ytPlayer.seekTo && ytPlayer.seekTo(sec, true); }

// フェード用：音量設定 (0〜100)
export function setVolume(vol) { ytPlayer && ytPlayer.setVolume && ytPlayer.setVolume(vol); }

export function getCurrentTime() { return ytPlayer && ytPlayer.getCurrentTime ? Math.floor(ytPlayer.getCurrentTime()) : 0; }
export function getPlayerState()  { return ytPlayer && ytPlayer.getPlayerState ? ytPlayer.getPlayerState() : -1; }

// タイトル取得
export async function fetchYouTubeTitle(videoId) {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(url);
    if (!res.ok) {
      alert(`YouTubeタイトル取得失敗（HTTP ${res.status}）`);
      return "";
    }
    const data = await res.json();
    return data.title || "";
  } catch (err) {
    alert("YouTubeタイトル取得時にネットワークエラー: " + err.message);
    return "";
  }
}

// 状態変更イベント用
export function setPlayerStateChangeCallback(fn) {
  window.onYouTubePlayerStateChange = fn;
}
