// main.js（1.動画ID自動取得・2.編集時の名前変更で新規追加 切替済み）

import { showTimeEditPopup, hideTimeEditPopup } from './popup.js';
import {
  playlistData, setPlaylistData, playlistToCSV, csvToPlaylist, renderPlaylist,
  initializePlaylist, savePlaylistToStorage, resetToDefaultPlaylist,
  getPlaylistNames, getCurrentPlaylistName, switchPlaylist,
  createPlaylist, renameCurrentPlaylist, deleteCurrentPlaylist
} from './playlist.js';
import {
  loadYouTubeAPI, setVideo, playVideo, pauseVideo, stopVideo, seekTo,
  getCurrentTime, getDuration, getVideoData, getPlayerState, fetchYouTubeTitle,
  setPlayerStateChangeCallback, setPlayerErrorCallback,
  fadeOutAndStop, setVolume, getVolume
} from './youtube.js';

let currentPlayingIdx = null;
let editingIndex = -1;
let selectedRating = 1;
let shuffleOn = false;
let loopOn = false;           // ループ再生フラグ
let editingTitleOriginal = "";
let endTimerDisabled = false; // 終了位置より先へ手動シークしたとき true

// 再生世代トークン: 曲の切替・停止のたびに増える。
// 古いタイマーやコールバックはトークン不一致で無効化され、
// 「素早い曲切替で前の曲の終了時間が適用される」レースを防ぐ。
let playToken = 0;
let startVerifiedToken = -1;  // 開始位置の検証を世代ごとに1回だけ行う
let consecutivePlayErrors = 0;
let lastPlayStartAt = 0;      // 直前の曲切替直後に届く旧動画のENDEDを無視するため

// 検索・ソート状態
let searchQuery = "";
let currentSortOrder = "default";

// セグメント進捗バー
let progressBarRAF = null;

// Undo削除バッファ
let deletedSongBuffer = null;
let deletedSongTimeout = null;

// ミュート状態
let isMuted = false;
let volumeBeforeMute = 100;

// トーストタイマー
let toastTimer = null;

// テーマ管理
let currentTheme = 0; // 0: 朝焼け, 1: 昼, 2: 夕焼け, 3: ミッドナイト
const themes = [
  { name: 'dawn', icon: '🌅', title: '朝焼けモード' },
  { name: 'day', icon: '☀️', title: '昼モード' },
  { name: 'sunset', icon: '🌆', title: '夕焼けモード' },
  { name: 'midnight', icon: '🌙', title: 'ミッドナイトモード' }
];

// テーマ切り替え関数
function switchTheme() {
  currentTheme = (currentTheme + 1) % themes.length;
  const theme = themes[currentTheme];
  
  // テーマ切り替えエフェクト
  document.body.style.transform = 'scale(0.98)';
  document.body.style.opacity = '0.8';
  
  setTimeout(() => {
    // テーマを適用
    if (theme.name === 'dawn') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme.name);
    }
    
    // インジケーター更新
    const indicator = document.getElementById('themeIndicator');
    if (indicator) {
      indicator.textContent = theme.icon;
      indicator.title = theme.title;
    }
    
    // ローカルストレージに保存
    localStorage.setItem('utawakuwaku_theme', currentTheme.toString());
    
    // トースト表示
    showToast(`${theme.title}に切り替えました`, 2000);
    
    // エフェクト復元
    document.body.style.transform = 'scale(1)';
    document.body.style.opacity = '1';
  }, 150);
}

// テーマを初期化
function initializeTheme() {
  const savedTheme = localStorage.getItem('utawakuwaku_theme');
  if (savedTheme !== null) {
    currentTheme = parseInt(savedTheme, 10) % themes.length;
    const theme = themes[currentTheme];
    
    if (theme.name === 'dawn') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme.name);
    }
    
    const indicator = document.getElementById('themeIndicator');
    if (indicator) {
      indicator.textContent = theme.icon;
      indicator.title = theme.title;
    }
  }
}

// YouTube動画長取得
async function getYouTubeDuration() {
  return getDuration();
}

// ★ フォームイベント再バインド
function initFormEventListeners(form) {
  form.onsubmit = (e) => {
    hideTimeEditPopup();
    e.preventDefault();

    let videoId = form.querySelector('#songVideoId').value.trim();
    if (!videoId) {
      const data = getVideoData();
      videoId = (data && data.video_id) || "";
      form.querySelector('#songVideoId').value = videoId;
    }

    const title = form.querySelector('#songTitle').value.trim();
    const startStr = form.querySelector('#startTime').value.trim();
    const endStr = form.querySelector('#endTime').value.trim();
    const start = parseInputTime(startStr);
    const end = parseInputTime(endStr);
    const article = form.querySelector('#songArticle').value.trim();
    const rating = selectedRating;
    if (!title) { 
      showToast("曲名/シーン名を入力してください"); 
      return; 
    }
    if (!videoId || videoId.length !== 11) { 
      showToast("動画IDを正しく入力してください"); 
      return; 
    }
    if (isNaN(start) || isNaN(end) || end < start) {
      showToast("開始・終了時間を正しく指定してください"); 
      return; 
    }
    const song = { videoId, title, start, end, rating, article };

    if (editingIndex >= 0) {
      const curTitle = form.querySelector('#songTitle').value.trim();
      if (curTitle !== editingTitleOriginal) {
        playlistData.push(song);
        editingIndex = -1;
        editingTitleOriginal = "";
        document.getElementById('btnAddSong').textContent = "リストに追加";
        // 編集中インジケーターを隠す
        const indicator = document.getElementById('currentlyEditingIndicator');
        if (indicator) indicator.style.display = 'none';
        showToast("新しい曲として追加しました");
      } else {
        playlistData[editingIndex] = song;
        editingIndex = -1;
        editingTitleOriginal = "";
        document.getElementById('btnAddSong').textContent = "リストに追加";
        // 編集中インジケーターを隠す
        const indicator = document.getElementById('currentlyEditingIndicator');
        if (indicator) indicator.style.display = 'none';
        showToast("曲を更新しました");
      }
    } else {
      playlistData.push(song);
      showToast("プレイリストに追加しました");
    }
    savePlaylistToStorage(); // 自動保存
    renderCurrentPlaylist();
    resetForm();
  };
  form.querySelector('#btnResetForm').onclick = (e) => {
    hideTimeEditPopup();
    e.preventDefault();
    resetForm();
  };
  form.querySelector('#btnEditStart').onclick = () => {
    showTimeEditPopup({
      fieldId: 'startTime',
      value: form.querySelector('#startTime').value,
      onOk: val => form.querySelector('#startTime').value = val,
      onCancel: () => {}
    });
  };
  form.querySelector('#btnEditEnd').onclick = () => {
    showTimeEditPopup({
      fieldId: 'endTime',
      value: form.querySelector('#endTime').value,
      onOk: val => form.querySelector('#endTime').value = val,
      onCancel: () => {}
    });
  };
  const btnGetCurrent = form.querySelector('#btnGetCurrent');
  if (btnGetCurrent) {
    btnGetCurrent.onclick = () => {
      hideTimeEditPopup();
      form.querySelector('#startTime').value = formatTime(getCurrentTime());
    };
  }
  form.querySelector('#btnGetCurrentStart').onclick = () => {
    hideTimeEditPopup();
    form.querySelector('#startTime').value = formatTime(getCurrentTime());
  };
  form.querySelector('#btnGetCurrentEnd').onclick = () => {
    hideTimeEditPopup();
    form.querySelector('#endTime').value = formatTime(getCurrentTime());
  };
  // btnSetDiff（差分機能）は削除済み
  monitorTitleForEdit(form);
}

// ★タイトル変更時に新規追加へ切り替え
function monitorTitleForEdit(form) {
  const titleInput = form.querySelector('#songTitle');
  titleInput.oninput = () => {
    if (editingIndex >= 0 && titleInput.value.trim() !== editingTitleOriginal) {
      // ボタン表示を「リストに追加」に
      document.getElementById('btnAddSong').textContent = "リストに追加";
    } else if (editingIndex >= 0) {
      document.getElementById('btnAddSong').textContent = "更新";
    }
  };
}

// フォーム物理再生成＋再バインド
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

function renderCurrentPlaylist() {
  renderPlaylist({
    ulId: "playlist",
    currentPlayingIdx,
    editingIdx: editingIndex,
    filterText: searchQuery,
    sortOrder: currentSortOrder,
    onPlay: playSongSection,
    onEdit: editSong,
    onDelete: deleteSong,
  });
  adjustWindowHeightByPlaylist();
  updatePlaylistCount();
}
window.renderCurrentPlaylist = renderCurrentPlaylist;

// 終了時間が有効か（未設定・開始以前なら動画の最後まで再生）
function hasValidEnd(song) {
  return !!song.end && song.end > song.start;
}

// プレイリストの曲再生（フェード付き・世代トークンでレース防止）
async function playSongSection(idx) {
  hideTimeEditPopup();
  const song = playlistData[idx];
  if (!song) return;

  const token = ++playToken;
  cancelEndTimer();

  // 前の曲が再生中ならフェードアウト
  if (currentPlayingIdx !== null && currentPlayingIdx !== idx) {
    await fadeOutAndStop(500);
    if (token !== playToken) return; // フェード中に別の曲が選ばれた
  }

  currentPlayingIdx = idx;
  endTimerDisabled = false;
  lastPlayStartAt = performance.now();

  startProgressBar();

  // 再生中の曲をフォームに自動表示
  autoFillFormWithCurrentSong(idx);

  // OSのメディアキー・ロック画面に曲情報を通知
  updateMediaSession(song);

  // フェードイン付きで新しい動画を開始
  // endSec を渡すとプレイヤー側でも区間終了が強制される（JSタイマーの保険）
  setVideo({
    videoId: song.videoId,
    seekSec: song.start,
    endSec: hasValidEnd(song) ? song.end : null,
    autoPlay: true,
    fadeIn: true
  });
  // 開始位置の検証と終了タイマーの起動は PLAYING イベント時に行う
  // （固定待ち時間ではバッファリング時間により失敗するため）

  renderCurrentPlaylist();
}

// 次の曲への遷移を一度だけ実行する（区間終了タイマーと ENDED イベントの二重発火防止）
function maybeAdvance(token) {
  if (token !== playToken) return;
  playToken++; // このトークンを消費して二重遷移を防ぐ
  playNextSong();
}

// 再生中の曲をフォームに自動表示する機能
function autoFillFormWithCurrentSong(idx) {
  if (editingIndex >= 0) return; // 既に編集中の場合はスキップ
  
  const song = playlistData[idx];
  if (!song) return;
  
  const form = document.getElementById('songForm');
  form.querySelector('#songTitle').value = song.title;
  form.querySelector('#songVideoId').value = song.videoId;
  form.querySelector('#startTime').value = formatTime(song.start);
  form.querySelector('#endTime').value = formatTime(song.end);
  form.querySelector('#songArticle').value = song.article || "";
  setRating(song.rating);
  
  // 編集状態に設定
  editingIndex = idx;
  editingTitleOriginal = song.title;
  document.getElementById('btnAddSong').textContent = "更新";
  
  // 編集中であることを示すインジケーターを表示
  const indicator = document.getElementById('currentlyEditingIndicator');
  if (indicator) {
    indicator.style.display = 'block';
  }
  
  renderCurrentPlaylist();
}

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
  editingIndex = idx;
  editingTitleOriginal = song.title; // 編集元タイトル保存
  document.getElementById('btnAddSong').textContent = "更新";
  
  // 編集中であることを示すインジケーターを表示
  const indicator = document.getElementById('currentlyEditingIndicator');
  if (indicator) {
    indicator.style.display = 'block';
  }
  
  monitorTitleForEdit(form);
  renderCurrentPlaylist();
}
function deleteSong(idx) {
  hideTimeEditPopup();
  const song = playlistData[idx];
  const songTitle = song.title;

  // Undo用にバッファ保存
  if (deletedSongTimeout) clearTimeout(deletedSongTimeout);
  deletedSongBuffer = { song: { ...song }, idx };

  playlistData.splice(idx, 1);
  savePlaylistToStorage();

  if (currentPlayingIdx === idx) {
    currentPlayingIdx = null;
    cancelEndTimer();
    stopProgressBar();
  } else if (currentPlayingIdx !== null && currentPlayingIdx > idx) {
    currentPlayingIdx -= 1;
  }
  if (editingIndex === idx) {
    resetForm();
  } else if (editingIndex > idx) {
    editingIndex -= 1;
  }

  renderCurrentPlaylist();

  showToast(`「${songTitle}」を削除しました`, 5000, {
    text: '元に戻す',
    callback: () => {
      if (!deletedSongBuffer) return;
      const { song: s, idx: i } = deletedSongBuffer;
      deletedSongBuffer = null;
      clearTimeout(deletedSongTimeout);
      playlistData.splice(Math.min(i, playlistData.length), 0, s);
      savePlaylistToStorage();
      renderCurrentPlaylist();
      showToast('削除を取り消しました');
    }
  });

  deletedSongTimeout = setTimeout(() => { deletedSongBuffer = null; }, 5000);
}

// 区間終了タイマー
// setInterval を使用（requestAnimationFrame はバックグラウンドタブで停止し、
// 終了時間を超えて再生され続ける原因だった）
let endTimerInterval = null;

function setEndTimer(endSec, token = playToken) {
  cancelEndTimer();

  endTimerInterval = setInterval(() => {
    if (token !== playToken || endTimerDisabled) {
      cancelEndTimer();
      return;
    }
    if (getPlayerState() !== 1) return; // 再生中のみ判定（バッファリング中の誤動作防止）

    const cur = getCurrentTime();

    // ユーザーが終了位置より先へシークした場合のみ自動終了を解除
    // （区間内のシークでは終了時間を必ず守る）
    if (cur > endSec + 1.5) {
      endTimerDisabled = true;
      cancelEndTimer();
      showToast("終了位置を越えてシークしたため、自動終了を解除しました", 2500);
      return;
    }

    // 終了時刻に近づいたらフェードアウトして次の曲へ
    if (cur >= endSec - 0.35) {
      cancelEndTimer();
      fadeOutAndStop(400).then(() => maybeAdvance(token));
    }
  }, 250);
}

function cancelEndTimer() {
  if (endTimerInterval) {
    clearInterval(endTimerInterval);
    endTimerInterval = null;
  }
}

// プレイリスト自動再生（ループ・シャッフル対応）
async function playNextSong() {
  hideTimeEditPopup();
  if (!playlistData.length) return;

  // ループ ON: 同じ曲を再再生
  if (loopOn && currentPlayingIdx !== null) {
    await playSongSection(currentPlayingIdx);
    return;
  }

  let nextIdx;
  if (shuffleOn) {
    do { nextIdx = Math.floor(Math.random() * playlistData.length); }
    while (playlistData.length > 1 && nextIdx === currentPlayingIdx);
  } else {
    nextIdx = (currentPlayingIdx === null) ? 0 : (currentPlayingIdx + 1) % playlistData.length;
  }
  await playSongSection(nextIdx);
}

async function playPrevSong() {
  hideTimeEditPopup();
  if (!playlistData.length) return;
  let prevIdx;
  if (shuffleOn) {
    do { prevIdx = Math.floor(Math.random() * playlistData.length); }
    while (playlistData.length > 1 && prevIdx === currentPlayingIdx);
  } else {
    prevIdx = (currentPlayingIdx === null || currentPlayingIdx === 0) ? playlistData.length - 1 : currentPlayingIdx - 1;
  }
  await playSongSection(prevIdx);
}

// 評価スター
function buildRatingStars() {
  const cont = document.getElementById('ratingStars');
  cont.innerHTML = '';
  for (let i = 1; i <= 6; ++i) {
    const span = document.createElement('span');
    span.className = 'star s'+i;
    span.innerHTML = i <= selectedRating ? "★" : "☆";
    span.style.cursor = 'pointer';
    span.onclick = () => setRating(i);
    cont.appendChild(span);
  }
}
function setRating(val) {
  selectedRating = val;
  buildRatingStars();
}

// YouTube URL/ID抽出
function extractYouTubeId(input) {
  const urlPattern = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w\-]{11})/;
  const idPattern = /^[\w\-]{11}$/;
  let m = input.match(urlPattern);
  if (m) return m[1];
  m = input.match(idPattern);
  if (m) return m[0];
  return null;
}

// トースト通知機能（アクションボタン対応）
function showToast(message, duration = 3000, action = null) {
  const toast = document.getElementById('toast');
  const msgEl = toast.querySelector('.toast-msg');

  // 既存アクションボタンを削除
  const oldBtn = toast.querySelector('.toast-action-btn');
  if (oldBtn) oldBtn.remove();

  msgEl.textContent = message;

  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action-btn';
    btn.textContent = action.text;
    btn.onclick = () => {
      action.callback();
      toast.classList.remove('show');
      clearTimeout(toastTimer);
    };
    toast.appendChild(btn);
  }

  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

// ボリューム制御
function initVolumeControl() {
  const volumeSlider = document.getElementById('volumeSlider');
  const volumeDisplay = document.getElementById('volumeDisplay');

  // 初期スタイル
  updateVolumeSliderStyle(parseInt(volumeSlider.value));

  volumeSlider.addEventListener('input', (e) => {
    const volume = parseInt(e.target.value);
    isMuted = false;
    volumeBeforeMute = volume;
    setVolume(volume);
    volumeDisplay.textContent = `${volume}%`;
    updateVolumeSliderStyle(volume);
    const icon = document.getElementById('volumeIcon');
    if (icon) icon.textContent = volume === 0 ? '🔇' : '🔊';
  });
}

// 時間入力
function parseInputTime(str) {
  if (!str) return 0;
  if (typeof str === "number") return Math.floor(str);
  str = str.trim();
  if (/^(\d{1,3}):(\d{1,2}):(\d{1,2})$/.test(str)) {
    const [_, h, m, s] = str.match(/^(\d{1,3}):(\d{1,2}):(\d{1,2})$/);
    return parseInt(h,10)*3600 + parseInt(m,10)*60 + parseInt(s,10);
  }
  if (/^(\d{1,3}):(\d{1,2})$/.test(str)) {
    const [_, m, s] = str.match(/^(\d{1,3}):(\d{1,2})$/);
    return parseInt(m,10)*60 + parseInt(s,10);
  }
  if (/^\d+$/.test(str)) {
    return parseInt(str, 10);
  }
  return 0;
}
function formatTime(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}` : `${m}:${s.toString().padStart(2,'0')}`;
}

// ===== Media Session API =====
// OSのメディアキー・ロック画面・イヤホンのボタンから操作できるようにする
function updateMediaSession(song) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title,
      artist: song.article || 'utawakuwaku',
      artwork: [
        { src: `https://i.ytimg.com/vi/${song.videoId}/mqdefault.jpg`, sizes: '320x180', type: 'image/jpeg' },
        { src: `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' }
      ]
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => playPrevSong());
    navigator.mediaSession.setActionHandler('nexttrack', () => playNextSong());
    navigator.mediaSession.setActionHandler('play', () => playVideo());
    navigator.mediaSession.setActionHandler('pause', () => pauseVideo());
  } catch (e) {
    // 未対応ブラウザでは何もしない
  }
}

// ===== セグメント進捗バー =====
function startProgressBar() {
  stopProgressBar();
  const bar = document.getElementById('segmentProgress');
  if (bar) bar.style.display = 'block';

  function update() {
    if (currentPlayingIdx === null) { stopProgressBar(); return; }
    const song = playlistData[currentPlayingIdx];
    if (!song) { stopProgressBar(); return; }
    const cur = getCurrentTime();
    const segDuration = song.end - song.start;
    const elapsed = cur - song.start;
    const pct = segDuration > 0 ? Math.min(100, Math.max(0, (elapsed / segDuration) * 100)) : 0;
    const fill = document.getElementById('segmentProgressFill');
    const curEl = document.getElementById('segProgressCurrent');
    const totEl = document.getElementById('segProgressTotal');
    if (fill) fill.style.width = pct + '%';
    if (curEl) curEl.textContent = formatTime(Math.max(0, elapsed));
    if (totEl) totEl.textContent = formatTime(Math.max(0, segDuration));
    progressBarRAF = requestAnimationFrame(update);
  }
  progressBarRAF = requestAnimationFrame(update);
}

function stopProgressBar() {
  if (progressBarRAF) { cancelAnimationFrame(progressBarRAF); progressBarRAF = null; }
  const bar = document.getElementById('segmentProgress');
  if (bar) bar.style.display = 'none';
  const fill = document.getElementById('segmentProgressFill');
  if (fill) fill.style.width = '0%';
}

// ===== ミュート切り替え =====
function toggleMute() {
  const slider = document.getElementById('volumeSlider');
  const display = document.getElementById('volumeDisplay');
  const icon = document.getElementById('volumeIcon');
  if (isMuted) {
    isMuted = false;
    const vol = volumeBeforeMute || 100;
    setVolume(vol);
    if (slider) { slider.value = vol; updateVolumeSliderStyle(vol); }
    if (display) display.textContent = vol + '%';
    if (icon) icon.textContent = '🔊';
    showToast('ミュート解除', 1500);
  } else {
    isMuted = true;
    volumeBeforeMute = slider ? parseInt(slider.value) : 100;
    setVolume(0);
    if (slider) { slider.value = 0; updateVolumeSliderStyle(0); }
    if (display) display.textContent = '0%';
    if (icon) icon.textContent = '🔇';
    showToast('ミュート', 1500);
  }
}

// ボリュームスライダーのグラデーション更新
function updateVolumeSliderStyle(volume) {
  const slider = document.getElementById('volumeSlider');
  if (slider) {
    slider.style.background = `linear-gradient(to right, var(--accent-primary) ${volume}%, var(--border-color) ${volume}%)`;
  }
}

// ===== プレイリスト件数表示 =====
function updatePlaylistCount() {
  const el = document.getElementById('playlistCount');
  if (!el) return;
  const total = playlistData.length;
  const query = searchQuery.trim().toLowerCase();
  if (query) {
    const filtered = playlistData.filter(s =>
      s.title.toLowerCase().includes(query) || (s.article || '').toLowerCase().includes(query)
    ).length;
    el.textContent = `${filtered} / ${total} 件`;
  } else {
    el.textContent = total > 0 ? `${total} 件` : '';
  }
}

// ===== キーボードショートカットヘルプ =====
function toggleKeyboardHelp() {
  const overlay = document.getElementById('keyboardHelpOverlay');
  if (overlay) overlay.classList.toggle('show');
}

// ウィンドウ高さ調整（Electron用）
function adjustWindowHeightByPlaylist() {
  if (!window.require) return;
  try {
    const { remote } = window.require('electron');
    const win = remote.getCurrentWindow();
    const baseHeight = 380;
    const rowHeight = 32;
    const n = playlistData.length;
    win.setSize(
      win.getSize()[0],
      Math.min(1080, baseHeight + rowHeight * n)
    );
  } catch (e) {
    // 無視
  }
}

// ★ UI/イベント初期化
window.addEventListener('DOMContentLoaded', async () => {
  // テーマ初期化
  initializeTheme();
  
  // テーマ切り替えイベント
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', switchTheme);
  }
  
  // プレイリスト初期化
  const hasExistingData = await initializePlaylist();
  if (!hasExistingData) {
    showToast("デフォルトプレイリストを読み込みました", 4000);
  }
  
  buildRatingStars();
  renderCurrentPlaylist();
  loadYouTubeAPI();
  initFormEventListeners(document.getElementById('songForm'));
  initVolumeControl();

  setPlayerStateChangeCallback((event) => {
    const btn = document.getElementById('btnPlayPause');
    if (event.data === 1) { btn.textContent = "⏸"; }
    else { btn.textContent = "▶"; }

    if (event.data === 0) { // 0=終了（自然終了 or endSeconds到達）
      // 曲切替直後のENDEDは前の動画のものなので無視（二重スキップ防止）
      if (performance.now() - lastPlayStartAt < 1000) return;
      maybeAdvance(playToken);
      return;
    }

    if (event.data === 1 && currentPlayingIdx !== null) { // 1=再生中
      consecutivePlayErrors = 0;
      const song = playlistData[currentPlayingIdx];
      if (!song) return;

      // 開始位置の検証（世代ごとに1回だけ）
      // 固定待ち時間の再シークをやめ、実際に再生が始まった時点でずれていた場合のみ補正
      if (startVerifiedToken !== playToken) {
        startVerifiedToken = playToken;
        const cur = getCurrentTime();
        if (Math.abs(cur - song.start) > 2) {
          seekTo(song.start);
        }
      }

      // 終了タイマーを（再）起動：一時停止→再開やシーク後も確実に守る
      if (hasValidEnd(song) && !endTimerDisabled) {
        setEndTimer(song.end);
      }
    }
  });

  // 再生エラー処理: 埋め込み不可・削除済み動画などを通知して自動スキップ
  setPlayerErrorCallback((event) => {
    const messages = {
      2: '動画IDが正しくありません',
      5: 'プレイヤーでエラーが発生しました',
      100: '動画が見つかりません（削除または非公開）',
      101: 'この動画は埋め込み再生が許可されていません',
      150: 'この動画は埋め込み再生が許可されていません'
    };
    const msg = messages[event.data] || `再生エラー (code: ${event.data})`;
    const song = currentPlayingIdx !== null ? playlistData[currentPlayingIdx] : null;
    consecutivePlayErrors++;
    cancelEndTimer();
    stopProgressBar();

    const action = song ? {
      text: 'YouTubeで開く',
      callback: () => window.open(
        `https://www.youtube.com/watch?v=${song.videoId}&t=${Math.floor(song.start)}s`, '_blank')
    } : null;
    showToast(`⚠️ ${msg}${song ? `：${song.title}` : ''}`, 6000, action);

    // 連続エラー時は無限スキップループを防ぐため停止
    if (song && consecutivePlayErrors < 5 && playlistData.length > 1) {
      const token = playToken;
      setTimeout(() => maybeAdvance(token), 1800);
    }
  });

  document.getElementById('shuffleBtn').onclick = function() {
    shuffleOn = !shuffleOn;
    this.classList.toggle('active', shuffleOn);
    this.title = shuffleOn ? 'シャッフル再生中 (S)' : 'シャッフル (S)';
    showToast(shuffleOn ? 'シャッフル ON' : 'シャッフル OFF', 1500);
  };

  // ===== ループボタン =====
  document.getElementById('loopBtn').onclick = function() {
    loopOn = !loopOn;
    this.classList.toggle('active', loopOn);
    this.title = loopOn ? 'ループ再生中 (L)' : 'ループ (L)';
    showToast(loopOn ? 'ループ ON' : 'ループ OFF', 1500);
  };

  // ===== キーボードショートカットヘルプ =====
  document.getElementById('helpBtn').addEventListener('click', toggleKeyboardHelp);
  document.getElementById('closeKeyboardHelp').addEventListener('click', () => {
    document.getElementById('keyboardHelpOverlay').classList.remove('show');
  });
  document.getElementById('keyboardHelpOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'keyboardHelpOverlay') {
      document.getElementById('keyboardHelpOverlay').classList.remove('show');
    }
  });

  // ===== 検索フィルター =====
  document.getElementById('playlistSearch').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    const clearBtn = document.getElementById('btnClearSearch');
    if (clearBtn) clearBtn.style.display = searchQuery ? 'inline-flex' : 'none';
    renderCurrentPlaylist();
  });
  document.getElementById('btnClearSearch').addEventListener('click', () => {
    searchQuery = '';
    document.getElementById('playlistSearch').value = '';
    document.getElementById('btnClearSearch').style.display = 'none';
    renderCurrentPlaylist();
  });

  // ===== ソート =====
  document.getElementById('sortSelect').addEventListener('change', (e) => {
    currentSortOrder = e.target.value;
    renderCurrentPlaylist();
  });

  // ===== ミュートアイコンクリック =====
  document.getElementById('volumeIcon').addEventListener('click', toggleMute);

  // ===== キーボードショートカット =====
  document.addEventListener('keydown', (e) => {
    // input/textarea/select フォーカス中はスキップ
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // ヘルプオーバーレイ表示中 Esc で閉じる
    if (e.key === 'Escape') {
      const overlay = document.getElementById('keyboardHelpOverlay');
      if (overlay && overlay.classList.contains('show')) {
        overlay.classList.remove('show');
        return;
      }
      return;
    }
    switch (e.key) {
      case ' ':
        e.preventDefault();
        document.getElementById('btnPlayPause').click();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        playPrevSong();
        break;
      case 'ArrowRight':
        e.preventDefault();
        playNextSong();
        break;
      case 's': case 'S':
        document.getElementById('shuffleBtn').click();
        break;
      case 'l': case 'L':
        document.getElementById('loopBtn').click();
        break;
      case 'm': case 'M':
        toggleMute();
        break;
      case '?':
        e.preventDefault();
        toggleKeyboardHelp();
        break;
    }
  });
  document.getElementById('videoForm').onsubmit = async (e) => {
    hideTimeEditPopup();
    e.preventDefault();
    const input = document.getElementById('ytUrl').value.trim();
    const vid = extractYouTubeId(input);
    if (!vid) {
      showToast("正しいYouTube URLまたはIDを入力してください");
      return;
    }
    // 区間再生を解除して動画を頭から読み込む
    playToken++;
    cancelEndTimer();
    stopProgressBar();
    currentPlayingIdx = null;
    renderCurrentPlaylist();
    document.getElementById('songVideoId').value = vid;
    setVideo({ videoId: vid, seekSec: 0, fadeIn: false });
    
    if (!document.getElementById('songArticle').value) {
      document.getElementById('songArticle').placeholder = "動画タイトル取得中...";
      showToast("動画タイトルを取得中...");
      const title = await fetchYouTubeTitle(vid);
      document.getElementById('songArticle').value = title;
      document.getElementById('songArticle').placeholder = "記事（自動取得/編集可）";
      if (title) {
        showToast("動画タイトルを取得しました");
      }
    }
  };
  document.getElementById('btnExportCSV').onclick = async () => {
    hideTimeEditPopup();
    const csv = playlistToCSV();
    const csvBox = document.getElementById('csvTextOutput');
    csvBox.style.display = "block";
    csvBox.value = csv;

    // Clipboard API（モダン）→ fallback
    try {
      await navigator.clipboard.writeText(csv);
      showToast("CSVをクリップボードにコピーしました");
    } catch {
      csvBox.select();
      try {
        document.execCommand("copy");
        showToast("CSVをクリップボードにコピーしました");
      } catch {
        showToast("CSV出力完了（テキストエリアからコピーしてください）");
      }
    }

    if (window.Blob && window.URL && window.URL.createObjectURL) {
      const now = new Date();
      const y = now.getFullYear(), mo = ("0"+(now.getMonth()+1)).slice(-2), d = ("0"+now.getDate()).slice(-2);
      const defaultName = `utawakuwaku_playlist_${y}${mo}${d}.csv`;
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 500);
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
        if (!arr.length) throw new Error("形式不正または空データ");
        setPlaylistData(arr);
        renderCurrentPlaylist();
        resetForm();
        hardRefreshSongForm();
        showToast(`${arr.length}件のプレイリストを読み込みました`);
      } catch (err) {
        showToast("CSV読込失敗: " + err.message);
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = "";
  };
  document.getElementById('btnPlayPause').onclick = () => {
    hideTimeEditPopup();
    if (currentPlayingIdx === null) { playSongSection(0); }
    else {
      const state = getPlayerState();
      if (state === 1) { pauseVideo(); }
      else { playVideo(); }
    }
  };
  document.getElementById('btnStop').onclick = () => {
    hideTimeEditPopup();
    stopPlayback();
    renderCurrentPlaylist();
  };
  document.getElementById('btnNext').onclick = playNextSong;
  document.getElementById('btnPrev').onclick = playPrevSong;
  
  // プレイリストリセットボタン
  document.getElementById('btnResetPlaylist').onclick = async () => {
    hideTimeEditPopup();
    if (confirm('プレイリストをデフォルトに戻しますか？\n現在のプレイリストは失われます。')) {
      const count = await resetToDefaultPlaylist();
      stopPlayback();
      renderCurrentPlaylist();
      resetForm();
      showToast(`デフォルトプレイリスト（${count}曲）を読み込みました`);
    }
  };

  // ===== 進捗バーのクリックでシーク =====
  const progressTrack = document.querySelector('#segmentProgress .segment-progress-track');
  if (progressTrack) {
    progressTrack.addEventListener('click', (e) => {
      if (currentPlayingIdx === null) return;
      const song = playlistData[currentPlayingIdx];
      if (!song || !hasValidEnd(song)) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      seekTo(song.start + ratio * (song.end - song.start));
    });
  }

  // ===== プレイリスト管理（複数リスト） =====
  initPlaylistManager();

  // ===== 共有URLからのインポート =====
  if (tryImportFromHash()) {
    refreshPlaylistSelect();
    renderCurrentPlaylist();
    resetForm();
  }
});

// ===== プレイリスト管理UI =====
function refreshPlaylistSelect() {
  const sel = document.getElementById('playlistSelect');
  if (!sel) return;
  sel.innerHTML = '';
  getPlaylistNames().forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (name === getCurrentPlaylistName()) opt.selected = true;
    sel.appendChild(opt);
  });
}

function initPlaylistManager() {
  const sel = document.getElementById('playlistSelect');
  if (!sel) return;
  refreshPlaylistSelect();

  sel.addEventListener('change', () => {
    if (switchPlaylist(sel.value)) {
      stopPlayback();
      resetForm();
      renderCurrentPlaylist();
      showToast(`「${sel.value}」に切り替えました`);
    }
    refreshPlaylistSelect();
  });

  document.getElementById('btnNewPlaylist').onclick = () => {
    hideTimeEditPopup();
    const name = (prompt('新しいプレイリスト名を入力してください') || '').trim();
    if (!name) return;
    if (!createPlaylist(name)) {
      showToast('同じ名前のプレイリストがあります');
      return;
    }
    stopPlayback();
    resetForm();
    refreshPlaylistSelect();
    renderCurrentPlaylist();
    showToast(`「${name}」を作成しました`);
  };

  document.getElementById('btnRenamePlaylist').onclick = () => {
    hideTimeEditPopup();
    const name = (prompt('新しい名前を入力してください', getCurrentPlaylistName()) || '').trim();
    if (!name || name === getCurrentPlaylistName()) return;
    if (!renameCurrentPlaylist(name)) {
      showToast('同じ名前のプレイリストがあります');
      return;
    }
    refreshPlaylistSelect();
    showToast(`「${name}」に変更しました`);
  };

  document.getElementById('btnDeletePlaylist').onclick = () => {
    hideTimeEditPopup();
    const name = getCurrentPlaylistName();
    if (getPlaylistNames().length <= 1) {
      showToast('最後のプレイリストは削除できません');
      return;
    }
    if (!confirm(`プレイリスト「${name}」を削除しますか？`)) return;
    if (deleteCurrentPlaylist()) {
      stopPlayback();
      resetForm();
      refreshPlaylistSelect();
      renderCurrentPlaylist();
      showToast(`「${name}」を削除しました`);
    }
  };

  document.getElementById('btnSharePlaylist').onclick = async () => {
    hideTimeEditPopup();
    if (!playlistData.length) {
      showToast('プレイリストが空です');
      return;
    }
    const url = buildShareUrl();
    try {
      await navigator.clipboard.writeText(url);
      showToast('共有URLをコピーしました。このURLを開くとプレイリストを取り込めます');
    } catch {
      prompt('共有URL（コピーしてください）', url);
    }
  };
}

// ===== プレイリスト共有URL =====
// CSVをURLセーフなBase64にしてハッシュに埋め込む（サーバー不要で共有できる）
function buildShareUrl() {
  const csv = playlistToCSV();
  const encoded = btoa(unescape(encodeURIComponent(csv)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return location.href.split('#')[0] + '#pl=' + encoded;
}

function tryImportFromHash() {
  if (!location.hash.startsWith('#pl=')) return false;
  const hashData = location.hash.slice(4);
  history.replaceState(null, '', location.pathname + location.search);
  try {
    let b64 = hashData.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const csv = decodeURIComponent(escape(atob(b64)));
    const arr = csvToPlaylist(csv);
    if (!arr.length) return false;
    if (!confirm(`共有されたプレイリスト（${arr.length}曲）を読み込みますか？\n新しいプレイリストとして追加されます。`)) {
      return false;
    }
    const base = '共有プレイリスト';
    let name = base;
    let n = 2;
    while (!createPlaylist(name, arr)) {
      name = `${base} ${n++}`;
      if (n > 99) return false;
    }
    showToast(`「${name}」を読み込みました（${arr.length}曲）`);
    return true;
  } catch (e) {
    console.warn('共有URLの読み込みに失敗:', e);
    showToast('共有URLの読み込みに失敗しました');
    return false;
  }
}

// 再生の完全停止（世代トークンを進めて残タイマーも無効化）
function stopPlayback() {
  playToken++;
  cancelEndTimer();
  stopProgressBar();
  stopVideo();
  currentPlayingIdx = null;
  const btn = document.getElementById('btnPlayPause');
  if (btn) btn.textContent = "▶";
}

// フォームリセット
function resetForm() {
  hideTimeEditPopup();
  const form = document.getElementById('songForm');
  form.reset();
  setRating(1);
  editingIndex = -1;
  document.getElementById('btnAddSong').textContent = "リストに追加";
  
  // 編集中インジケーターを隠す
  const indicator = document.getElementById('currentlyEditingIndicator');
  if (indicator) {
    indicator.style.display = 'none';
  }
  
  // 全input/textarea編集可
  form.querySelectorAll('input, textarea').forEach(inp => {
    inp.style.pointerEvents = '';
    inp.style.userSelect = '';
    inp.readOnly = false;
    inp.disabled = false;
  });
  
  renderCurrentPlaylist();
}
