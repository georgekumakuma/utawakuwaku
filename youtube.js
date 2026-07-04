// youtube.js
// YouTubeプレイヤーAPI管理モジュール

let ytPlayer = null;
let ytReady = false;
let playerReadyCallback = null;
let fadeAnimationId = null;
let currentVolume = 100;
let pendingVideo = null; // プレイヤー準備前に再生要求された動画を保持

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
      'onReady': () => {
        ytReady = true;
        // 準備完了前に要求された動画があれば再生
        if (pendingVideo) {
          const v = pendingVideo;
          pendingVideo = null;
          setVideo(v);
        }
      },
      'onStateChange': (event) => {
        if (typeof window.onYouTubePlayerStateChange === 'function') {
          window.onYouTubePlayerStateChange(event);
        }
      },
      'onError': (event) => {
        if (typeof window.onYouTubePlayerError === 'function') {
          window.onYouTubePlayerError(event);
        }
      }
    },
    playerVars: {
      'controls': 1,
      'modestbranding': 1,
      'rel': 0,
      'playsinline': 1
    }
  });
  // popup.js など他モジュールからも参照できるように公開
  window.ytPlayer = ytPlayer;
}

// 動画再生（フェードイン・区間終了指定対応）
export function setVideo({ videoId, seekSec = 0, endSec = null, autoPlay = true, fadeIn = true }) {
  if (!ytPlayer || !ytReady) {
    // プレイヤー未準備なら保留して onReady 後に再生
    pendingVideo = { videoId, seekSec, endSec, autoPlay, fadeIn };
    return;
  }

  const loadParams = { videoId, startSeconds: seekSec || 0 };
  // endSeconds はプレイヤー側でも区間終了を強制する保険
  // （バックグラウンドタブ等でJSタイマーが停止しても確実に止まる）
  if (endSec && endSec > (seekSec || 0)) {
    loadParams.endSeconds = endSec;
  }

  if (fadeIn && autoPlay) {
    ytPlayer.setVolume(0);
    ytPlayer.loadVideoById(loadParams);
    ytPlayer.playVideo();
    fadeVolume(0, currentVolume, 1000); // 1秒でフェードイン
  } else {
    ytPlayer.loadVideoById(loadParams);
    if (autoPlay) ytPlayer.playVideo();
  }
}

// フェードアウト付き停止
export function fadeOutAndStop(duration = 800) {
  return new Promise((resolve) => {
    if (!ytPlayer || !ytPlayer.getVolume) { resolve(); return; }
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
export function getDuration() { return ytPlayer && ytPlayer.getDuration ? ytPlayer.getDuration() : 0; }
export function getPlayerState()  { return ytPlayer && ytPlayer.getPlayerState ? ytPlayer.getPlayerState() : -1; }
export function getVideoData() { return ytPlayer && ytPlayer.getVideoData ? ytPlayer.getVideoData() : null; }
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

// プレイヤーエラーイベント用（windowグローバルに割当）
// エラーコード: 2=不正なID, 5=HTML5エラー, 100=削除/非公開, 101/150=埋め込み不可
export function setPlayerErrorCallback(fn) {
  window.onYouTubePlayerError = fn;
}
