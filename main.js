// main.js
import { showTimeEditPopup, hideTimeEditPopup } from './popup.js';
import {
  playlistData,
  setPlaylistData,
  playlistToCSV,
  csvToPlaylist,
  renderPlaylist
} from './playlist.js';
import {
  loadYouTubeAPI,
  setVideo,
  playVideo,
  pauseVideo,
  stopVideo,
  seekTo,
  getCurrentTime,
  getPlayerState,
  fetchYouTubeTitle,
  setPlayerStateChangeCallback
} from './youtube.js';

// 定数定義
const CONFIG = {
  VIDEO_ID_LENGTH: 11,
  MAX_RATING: 6,
  END_TIMER_OFFSET: 1,
  NEXT_SONG_DELAY: 300,
  BASE_WINDOW_HEIGHT: 380,
  ROW_HEIGHT: 32,
  MAX_WINDOW_HEIGHT: 1080,
  DOWNLOAD_DELAY: 500
};

// グローバル状態管理
const appState = {
  currentPlayingIdx: null,
  editingIndex: -1,
  selectedRating: 1,
  shuffleOn: false,
  editingTitleOriginal: "",
  pendingSeekSec: null,
  pendingEndSec: null,
  endTimerRAF: null
};

// DOM要素キャッシュ
const domElements = {
  songForm: null,
  songTitle: null,
  songVideoId: null,
  songArticle: null,
  startTime: null,
  endTime: null,
  btnAddSong: null,
  btnPlayPause: null,
  btnResetForm: null,
  btnEditStart: null,
  btnEditEnd: null,
  btnGetCurrent: null,
  ratingStars: null,
  shuffleBtn: null,
  videoForm: null,
  ytUrl: null,
  playlist: null,
  csvTextOutput: null,
  csvFileInput: null
};

/**
 * DOM要素をキャッシュする
 */
function cacheDOMElements() {
  domElements.songForm = document.getElementById('songForm');
  domElements.songTitle = document.getElementById('songTitle');
  domElements.songVideoId = document.getElementById('songVideoId');
  domElements.songArticle = document.getElementById('songArticle');
  domElements.startTime = document.getElementById('startTime');
  domElements.endTime = document.getElementById('endTime');
  domElements.btnAddSong = document.getElementById('btnAddSong');
  domElements.btnPlayPause = document.getElementById('btnPlayPause');
  domElements.btnResetForm = document.getElementById('btnResetForm');
  domElements.btnEditStart = document.getElementById('btnEditStart');
  domElements.btnEditEnd = document.getElementById('btnEditEnd');
  domElements.btnGetCurrent = document.getElementById('btnGetCurrent');
  domElements.ratingStars = document.getElementById('ratingStars');
  domElements.shuffleBtn = document.getElementById('shuffleBtn');
  domElements.videoForm = document.getElementById('videoForm');
  domElements.ytUrl = document.getElementById('ytUrl');
  domElements.playlist = document.getElementById('playlist');
  domElements.csvTextOutput = document.getElementById('csvTextOutput');
  domElements.csvFileInput = document.getElementById('csvFileInput');
}

// ---- キャッシュ管理＋デフォルトCSV読み込み ----
/**
 * プレイリストをlocalStorageに保存する
 */
function savePlaylistToCache() {
  try {
    localStorage.setItem('playlist', playlistToCSV());
  } catch (e) {
    console.error('Failed to save playlist to cache', e);
  }
}

/**
 * プレイリストをlocalStorageまたはデフォルトCSVから読み込む
 */
async function loadPlaylistFromCacheOrDefault() {
  const saved = localStorage.getItem('playlist');
  if (saved) {
    setPlaylistData(csvToPlaylist(saved));
  } else {
    try {
      const res = await fetch('utawakuwaku_playlist_default.csv');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      setPlaylistData(csvToPlaylist(text));
      savePlaylistToCache();
    } catch (e) {
      console.error('Failed to load default playlist', e);
      setPlaylistData([]);
    }
  }
}

/**
 * YouTube動画の長さを取得する
 * @returns {Promise<number>} 動画の長さ（秒）
 */
async function getYouTubeDuration() {
  try {
    if (window.ytPlayer && ytPlayer.getDuration) {
      return ytPlayer.getDuration();
    }
    return 0;
  } catch (error) {
    console.error('Failed to get YouTube duration:', error);
    return 0;
  }
}

/**
 * YouTube動画の長さを取得する
 * @returns {Promise<number>} 動画の長さ（秒）
 */
async function getYouTubeDuration() {
  try {
    if (window.ytPlayer && ytPlayer.getDuration) {
      return ytPlayer.getDuration();
    }
    return 0;
  } catch (error) {
    console.error('Failed to get YouTube duration:', error);
    return 0;
  }
}

/**
 * フォームデータを検証する
 * @param {Object} formData - 検証するフォームデータ
 * @returns {string[]} エラーメッセージの配列
 */
function validateSongForm(formData) {
  const errors = [];
  
  if (!formData.title) {
    errors.push("曲名/シーン名を入力してください。");
  }
  if (!formData.videoId || formData.videoId.length !== CONFIG.VIDEO_ID_LENGTH) {
    errors.push("動画IDを正しく入力してください。");
  }
  if (isNaN(formData.start) || isNaN(formData.end) || formData.end < formData.start) {
    errors.push("開始・終了時間を正しく指定してください。");
  }
  
  return errors;
}

/**
 * フォーム送信を処理する
 * @param {HTMLFormElement} form - 送信されたフォーム
 * @param {Event} e - イベントオブジェクト
 */
function handleFormSubmit(form, e) {
  hideTimeEditPopup();
  e.preventDefault();

  let videoId = form.querySelector('#songVideoId').value.trim();
  if (!videoId && window.ytPlayer && ytPlayer.getVideoData) {
    videoId = ytPlayer.getVideoData().video_id || "";
    form.querySelector('#songVideoId').value = videoId;
  }

  const title = form.querySelector('#songTitle').value.trim();
  const startStr = form.querySelector('#startTime').value.trim();
  const endStr = form.querySelector('#endTime').value.trim();
  const start = parseInputTime(startStr);
  const end = parseInputTime(endStr);
  const article = form.querySelector('#songArticle').value.trim();
  const rating = appState.selectedRating;

  const formData = { videoId, title, start, end };
  const errors = validateSongForm(formData);
  
  if (errors.length > 0) {
    alert(errors.join('\n'));
    return;
  }

  const song = { videoId, title, start, end, rating, article };

  if (appState.editingIndex >= 0) {
    const curTitle = form.querySelector('#songTitle').value.trim();
    if (curTitle !== appState.editingTitleOriginal) {
      // タイトル変更による「新規追加」モード
      playlistData.push(song);
      appState.editingIndex = -1;
      appState.editingTitleOriginal = "";
      domElements.btnAddSong.textContent = "リストに追加";
    } else {
      // 単に編集しただけ
      playlistData[appState.editingIndex] = song;
      appState.editingIndex = -1;
      appState.editingTitleOriginal = "";
      domElements.btnAddSong.textContent = "リストに追加";
    }
  } else {
    playlistData.push(song);
  }

  renderCurrentPlaylist();
  savePlaylistToCache();
  resetForm();
}

/**
 * フォームリセットボタンを処理する
 * @param {Event} e - イベントオブジェクト
 */
function handleFormReset(e) {
  hideTimeEditPopup();
  e.preventDefault();
  resetForm();
}

/**
 * 開始時間編集ボタンを処理する
 * @param {HTMLFormElement} form - フォーム要素
 */
function handleEditStartTime(form) {
  showTimeEditPopup({
    fieldId: 'startTime',
    value: form.querySelector('#startTime').value,
    onOk: (val) => form.querySelector('#startTime').value = val,
    onCancel: () => {}
  });
}

/**
 * 終了時間編集ボタンを処理する
 * @param {HTMLFormElement} form - フォーム要素
 */
function handleEditEndTime(form) {
  showTimeEditPopup({
    fieldId: 'endTime',
    value: form.querySelector('#endTime').value,
    onOk: (val) => form.querySelector('#endTime').value = val,
    onCancel: () => {}
  });
}

/**
 * 現在時刻取得ボタンを処理する
 * @param {HTMLFormElement} form - フォーム要素
 */
function handleGetCurrentTime(form) {
  hideTimeEditPopup();
  form.querySelector('#startTime').value = formatTime(getCurrentTime());
}

/**
 * フォームイベントリスナーを初期化する
 * @param {HTMLFormElement} form - フォーム要素
 */
function initFormEventListeners(form) {
  form.onsubmit = (e) => handleFormSubmit(form, e);
  form.querySelector('#btnResetForm').onclick = (e) => handleFormReset(e);
  form.querySelector('#btnEditStart').onclick = () => handleEditStartTime(form);
  form.querySelector('#btnEditEnd').onclick = () => handleEditEndTime(form);
  form.querySelector('#btnGetCurrent').onclick = () => handleGetCurrentTime(form);
}

// ★タイトル変更時に「新規追加」へ切り替え
function monitorTitleForEdit(form) {
  const titleInput = form.querySelector('#songTitle');
  titleInput.oninput = () => {
    if (appState.editingIndex >= 0 && titleInput.value.trim() !== appState.editingTitleOriginal) {
      domElements.btnAddSong.textContent = "リストに追加";
    } else if (appState.editingIndex >= 0) {
      domElements.btnAddSong.textContent = "更新";
    }
  };
}

// プレイリストを表示
function renderCurrentPlaylist() {
  renderPlaylist({
    ulId: "playlist",
    currentPlayingIdx: appState.currentPlayingIdx,
    onPlay: playSongSection,
    onEdit: editSong,
    onDelete: deleteSong
  });
  adjustWindowHeightByPlaylist();
}
window.renderCurrentPlaylist = renderCurrentPlaylist;

/**
 * 指定されたインデックスの曲を再生する
 * @param {number} idx - プレイリスト内のインデックス
 */
function playSongSection(idx) {
  hideTimeEditPopup();
  cancelEndTimer();
  const song = playlistData[idx];
  if (!song) return;
  appState.currentPlayingIdx = idx;
  appState.pendingSeekSec = song.start;
  if (song.end > song.start) {
    appState.pendingEndSec = song.end;
  } else {
    appState.pendingEndSec = null;
  }
  setVideo({ videoId: song.videoId, seekSec: 0, endSec: null, autoPlay: true });
  renderCurrentPlaylist();
}

/**
 * 編集ボタン：曲情報をフォームへ読み込み
 * @param {number} idx - 編集する曲のインデックス
 */
function editSong(idx) {
  hideTimeEditPopup();
  cancelEndTimer();
  const form = document.getElementById('songForm');
  const song = playlistData[idx];
  form.querySelector('#songTitle').value = song.title;
  form.querySelector('#songVideoId').value = song.videoId;
  form.querySelector('#startTime').value = formatTime(song.start);
  form.querySelector('#endTime').value = formatTime(song.end);
  form.querySelector('#songArticle').value = song.article || "";
  setRating(song.rating);
  appState.editingIndex = idx;
  appState.editingTitleOriginal = song.title;
  domElements.btnAddSong.textContent = "更新";
  monitorTitleForEdit(form);
}

/**
 * 削除ボタン：曲をリストから消去
 * @param {number} idx - 削除する曲のインデックス
 */
function deleteSong(idx) {
  hideTimeEditPopup();
  if (confirm("この曲を削除しますか？")) {
    playlistData.splice(idx, 1);
    renderCurrentPlaylist();
    savePlaylistToCache();
    resetForm();
    if (appState.currentPlayingIdx === idx) {
      appState.currentPlayingIdx = null;
    } else if (appState.currentPlayingIdx > idx) {
      appState.currentPlayingIdx -= 1;
    }
  }
}

// 区間再生タイマー管理
/**
 * 終了タイマーを設定する
 * @param {number} endSec - 終了時刻（秒）
 */
function setEndTimer(endSec) {
  cancelEndTimer();
  function check() {
    const cur = getCurrentTime();
    if (cur >= endSec - CONFIG.END_TIMER_OFFSET) {
      pauseVideo();
      cancelEndTimer();
      setTimeout(() => playNextSong(), CONFIG.NEXT_SONG_DELAY);
      return;
    }
    appState.endTimerRAF = requestAnimationFrame(check);
  }
  appState.endTimerRAF = requestAnimationFrame(check);
}

/**
 * 終了タイマーをキャンセルする
 */
function cancelEndTimer() {
  if (appState.endTimerRAF) {
    cancelAnimationFrame(appState.endTimerRAF);
    appState.endTimerRAF = null;
  }
}

// プレイリスト自動再生：次/前の曲
/**
 * ランダムなインデックスを取得する（シャッフル用）
 * @param {number|null} excludeIdx - 除外するインデックス
 * @returns {number|null} ランダムなインデックス
 */
function getRandomIndex(excludeIdx = null) {
  if (playlistData.length === 0) return null;
  if (playlistData.length === 1) return 0;
  
  let idx;
  do {
    idx = Math.floor(Math.random() * playlistData.length);
  } while (idx === excludeIdx);
  
  return idx;
}

/**
 * 次の曲を再生する
 */
function playNextSong() {
  hideTimeEditPopup();
  if (!playlistData.length) return;
  let nextIdx;
  if (appState.shuffleOn) {
    nextIdx = getRandomIndex(appState.currentPlayingIdx);
  } else {
    nextIdx = (appState.currentPlayingIdx === null) ? 0 :
              (appState.currentPlayingIdx + 1) % playlistData.length;
  }
  playSongSection(nextIdx);
}

/**
 * 前の曲を再生する
 */
function playPrevSong() {
  hideTimeEditPopup();
  if (!playlistData.length) return;
  let prevIdx;
  if (appState.shuffleOn) {
    prevIdx = getRandomIndex(appState.currentPlayingIdx);
  } else {
    prevIdx = (appState.currentPlayingIdx === null || appState.currentPlayingIdx === 0) ?
              playlistData.length - 1 :
              appState.currentPlayingIdx - 1;
  }
  playSongSection(prevIdx);
}

// 評価スター
/**
 * 評価スターを構築する
 */
function buildRatingStars() {
  const cont = domElements.ratingStars;
  cont.innerHTML = '';
  for (let i = 1; i <= CONFIG.MAX_RATING; ++i) {
    const span = document.createElement('span');
    span.className = 'star s' + i;
    span.innerHTML = i <= appState.selectedRating ? "★" : "☆";
    span.style.cursor = 'pointer';
    span.onclick = () => setRating(i);
    cont.appendChild(span);
  }
}

/**
 * 評価を設定する
 * @param {number} val - 評価値（1-6）
 */
function setRating(val) {
  appState.selectedRating = val;
  buildRatingStars();
}

// YouTube URL/ID抽出
/**
 * YouTube URLまたはIDから動画IDを抽出する
 * @param {string} input - YouTube URLまたはID
 * @returns {string|null} 動画ID（11文字）またはnull
 */
function extractYouTubeId(input) {
  const urlPattern = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w\-]{11})/;
  const idPattern = /^[\w\-]{11}$/;
  let m = input.match(urlPattern);
  if (m) return m[1];
  m = input.match(idPattern);
  if (m) return m[0];
  return null;
}

// 時間文字列を秒に変換
/**
 * 時間文字列を秒に変換する
 * @param {string|number} str - 時間文字列または数値
 * @returns {number} 秒数
 */
function parseInputTime(str) {
  if (!str) return 0;
  if (typeof str === "number") return Math.floor(str);
  str = str.trim();
  if (/^(\d{1,3}):(\d{1,2}):(\d{1,2})$/.test(str)) {
    const [_, h, m, s] = str.match(/^(\d{1,3}):(\d{1,2}):(\d{1,2})$/);
    return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10);
  }
  if (/^(\d{1,3}):(\d{1,2})$/.test(str)) {
    const [_, m, s] = str.match(/^(\d{1,3}):(\d{1,2})$/);
    return parseInt(m, 10) * 60 + parseInt(s, 10);
  }
  if (/^\d+$/.test(str)) {
    return parseInt(str, 10);
  }
  return 0;
}

// 秒を「h:mm:ss」または「m:ss」にフォーマット
/**
 * 秒数を時間文字列にフォーマットする
 * @param {number} sec - 秒数
 * @returns {string} フォーマットされた時間文字列
 */
function formatTime(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
}

// ウィンドウ高さ調整（Electron用）
function adjustWindowHeightByPlaylist() {
  if (!window.require) return;
  try {
    const { remote } = window.require('electron');
    const win = remote.getCurrentWindow();
    const n = playlistData.length;
    win.setSize(
      win.getSize()[0],
      Math.min(CONFIG.MAX_WINDOW_HEIGHT, CONFIG.BASE_WINDOW_HEIGHT + CONFIG.ROW_HEIGHT * n)
    );
  } catch (e) {
    console.error('Failed to adjust window height:', e);
  }
}

// ★ UI/イベント初期化
window.addEventListener('DOMContentLoaded', async () => {
  cacheDOMElements();
  buildRatingStars();
  await loadPlaylistFromCacheOrDefault();
  renderCurrentPlaylist();
  loadYouTubeAPI();

  // まずフォームのイベントをバインド
  initFormEventListeners(domElements.songForm);
  monitorTitleForEdit(domElements.songForm);

  // YouTubeプレイヤーの状態変化を監視
  setPlayerStateChangeCallback((event) => {
    if (event.data === YT.PlayerState.PLAYING) {
      domElements.btnPlayPause.textContent = "⏸";
      if (appState.pendingSeekSec !== null) {
        seekTo(appState.pendingSeekSec);
        appState.pendingSeekSec = null;
      }
      if (appState.pendingEndSec !== null) {
        setEndTimer(appState.pendingEndSec);
        appState.pendingEndSec = null;
      }
    } else {
      domElements.btnPlayPause.textContent = "▶";
    }
    if (event.data === YT.PlayerState.ENDED) {
      setTimeout(() => playNextSong(), CONFIG.NEXT_SONG_DELAY);
    }
  });

  document.getElementById('shuffleBtn').onclick = function () {
    appState.shuffleOn = !appState.shuffleOn;
    this.classList.toggle('active', appState.shuffleOn);
    this.title = appState.shuffleOn ? "シャッフル再生中" : "シャッフル再生";
  };

  document.getElementById('videoForm').onsubmit = async (e) => {
    hideTimeEditPopup();
    e.preventDefault();
    cancelEndTimer();
    const input = document.getElementById('ytUrl').value.trim();
    const vid = extractYouTubeId(input);
    if (!vid) {
      alert("正しいYouTube URLまたはIDを入力してください。");
      return;
    }
    document.getElementById('songVideoId').value = vid;
    setVideo({ videoId: vid, seekSec: 0 });
    if (!document.getElementById('songArticle').value) {
      document.getElementById('songArticle').placeholder = "動画タイトル取得中...";
      const title = await fetchYouTubeTitle(vid);
      document.getElementById('songArticle').value = title;
      document.getElementById('songArticle').placeholder = "記事（自動取得/編集可）";
    }
  };

  document.getElementById('btnPlayPause').onclick = () => {
    hideTimeEditPopup();
    if (appState.currentPlayingIdx === null) {
      playSongSection(0);
    } else {
      const state = getPlayerState();
      if (state === YT.PlayerState.PLAYING) {
        pauseVideo();
      } else {
        playVideo();
      }
    }
  };

  document.getElementById('btnStop').onclick = () => {
    hideTimeEditPopup();
    cancelEndTimer();
    stopVideo();
    appState.currentPlayingIdx = null;
    renderCurrentPlaylist();
    domElements.btnPlayPause.textContent = "▶";
  };

  document.getElementById('btnNext').onclick = playNextSong;
  document.getElementById('btnPrev').onclick = playPrevSong;

  document.getElementById('btnExportCSV').onclick = () => {
    hideTimeEditPopup();
    const csv = playlistToCSV();
    const csvBox = document.getElementById('csvTextOutput');
    csvBox.style.display = "block";
    csvBox.value = csv;
    csvBox.select();
    try {
      document.execCommand("copy");
    } catch {
      // コピー失敗しても OK
    }
    if (window.Blob && window.URL && window.URL.createObjectURL) {
      const now = new Date();
      const y = now.getFullYear(),
        m = ("0" + (now.getMonth() + 1)).slice(-2),
        d = ("0" + now.getDate()).slice(-2);
      const defaultName = `utawakuwaku_playlist_${y}${m}${d}.csv`;
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, CONFIG.DOWNLOAD_DELAY);
    }
  };

  document.getElementById('btnImportCSV').onclick = () => {
    hideTimeEditPopup();
    document.getElementById('csvFileInput').click();
  };

  document.getElementById('csvFileInput').onchange = (e) => {
    hideTimeEditPopup();
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const arr = csvToPlaylist(e.target.result);
        if (!arr.length) throw new Error("CSV形式が正しくありません。");
        setPlaylistData(arr);
        renderCurrentPlaylist();
        savePlaylistToCache();
        resetForm();
        // フォーム再生成で入力不可バグ回避
        hardRefreshSongForm();
      } catch (err) {
        alert("CSV読込失敗: " + err.message);
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = "";
  };
});

// フォームリセット
function resetForm() {
  hideTimeEditPopup();
  const form = document.getElementById('songForm');
  form.reset();
  setRating(1);
  appState.editingIndex = -1;
  document.getElementById('btnAddSong').textContent = "リストに追加";
  // 全 input/textarea を編集可能に戻す
  form.querySelectorAll('input, textarea').forEach(inp => {
    inp.style.pointerEvents = '';
    inp.style.userSelect = '';
    inp.readOnly = false;
    inp.disabled = false;
  });
}

// フォーム再生成（入力不可バグ回避）
function hardRefreshSongForm() {
  const form = document.getElementById('songForm');
  if (!form) return;
  const parent = form.parentNode;
  const next = form.nextSibling;
  const html = form.outerHTML;
  parent.removeChild(form);
  const temp = document.createElement('div');
  temp.innerHTML = html;
  const newForm = temp.firstElementChild;
  parent.insertBefore(newForm, next);
  initFormEventListeners(newForm);
  monitorTitleForEdit(newForm);

  newForm.querySelectorAll('input, textarea').forEach(inp => {
    inp.style.pointerEvents = '';
    inp.style.userSelect = '';
    inp.readOnly = false;
    inp.disabled = false;
  });
}
