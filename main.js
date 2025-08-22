// main.js（1.動画ID自動取得・2.編集時の名前変更で新規追加 切替済み）

import { showTimeEditPopup, hideTimeEditPopup } from './popup.js';
import { 
  playlistData, setPlaylistData, playlistToCSV, csvToPlaylist, renderPlaylist, 
  initializePlaylist, savePlaylistToStorage, resetToDefaultPlaylist 
} from './playlist.js';
import { 
  loadYouTubeAPI, setVideo, playVideo, pauseVideo, stopVideo, seekTo,
  getCurrentTime, getPlayerState, fetchYouTubeTitle, setPlayerStateChangeCallback,
  fadeOutAndStop, setVolume, getVolume
} from './youtube.js';

let currentPlayingIdx = null;
let editingIndex = -1;
let selectedRating = 1;
let shuffleOn = false;
let editingTitleOriginal = ""; // ★編集前タイトル保存用
let userSeekedManually = false; // ユーザーが手動でシークしたかを追跡
let endTimerDisabled = false; // 終了タイマーを無効化するフラグ

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
  if (window.ytPlayer && ytPlayer.getDuration) {
    return ytPlayer.getDuration();
  }
  return 0;
}

// ★ フォームイベント再バインド
function initFormEventListeners(form) {
  form.onsubmit = (e) => {
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
    onPlay: playSongSection,
    onEdit: editSong,
    onDelete: deleteSong,
  });
  adjustWindowHeightByPlaylist();
}
window.renderCurrentPlaylist = renderCurrentPlaylist;

// プレイリストの曲再生（改良版：フェード機能付き + フォーム自動表示）
async function playSongSection(idx) {
  hideTimeEditPopup();
  const song = playlistData[idx];
  if (!song) return;
  
  // 前の曲が再生中ならフェードアウト
  if (currentPlayingIdx !== null && currentPlayingIdx !== idx) {
    await fadeOutAndStop(600);
  }
  
  currentPlayingIdx = idx;
  userSeekedManually = false;
  endTimerDisabled = false;
  
  // 再生中の曲をフォームに自動表示
  autoFillFormWithCurrentSong(idx);
  
  // フェードイン付きで新しい動画を開始
  setVideo({ 
    videoId: song.videoId, 
    seekSec: song.start, 
    endSec: song.end, 
    autoPlay: true,
    fadeIn: true 
  });
  
  // より正確な位置調整のため少し待ってから再度シーク
  setTimeout(async () => {
    let videoDuration = 0;
    if (window.ytPlayer && ytPlayer.getDuration) {
      videoDuration = ytPlayer.getDuration();
    }
    
    // 開始位置の精密調整
    seekTo(song.start);
    
    if (!song.end || song.end <= song.start || (videoDuration > 0 && song.end > videoDuration - 1)) {
      // 最後まで再生
    } else {
      setEndTimer(song.end);
    }
    renderCurrentPlaylist();
  }, 800); // 少し長めに待つ
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
  if (confirm(`「${song.title}」を削除しますか？`)) {
    playlistData.splice(idx, 1);
    savePlaylistToStorage(); // 自動保存
    renderCurrentPlaylist();
    resetForm();
    if (currentPlayingIdx === idx) {
      currentPlayingIdx = null;
    } else if (currentPlayingIdx > idx) {
      currentPlayingIdx -= 1;
    }
    showToast("曲を削除しました");
  }
}

// 区間再生管理（改良版：ユーザーシーク検出機能付き）
let endTimerRAF = null;
let lastCheckedTime = 0;
let seekDetectionThreshold = 1.5; // シーク検出のしきい値（秒）

function setEndTimer(endSec) {
  if (endTimerDisabled) return; // 終了タイマーが無効化されている場合はスキップ
  
  cancelEndTimer();
  lastCheckedTime = 0;
  
  function check() {
    if (endTimerDisabled) return; // チェック中に無効化された場合はスキップ
    
    const cur = getCurrentTime();
    
    // 大きな時間の飛びを検出（ユーザーがシークした場合）
    if (Math.abs(cur - lastCheckedTime) > seekDetectionThreshold && lastCheckedTime > 0) {
      userSeekedManually = true;
      // ユーザーがシークした場合、終了タイマーを無効化
      endTimerDisabled = true;
      cancelEndTimer();
      showToast("手動シーク検出: 自動終了を無効化しました", 2000);
      return;
    }
    
    // 終了時刻に近づいたら（0.3秒前からフェードアウト開始）
    if (cur >= endSec - 0.3 && !userSeekedManually) {
      cancelEndTimer();
      
      // フェードアウトして次の曲へ
      fadeOutAndStop(500).then(() => {
        setTimeout(() => playNextSong(), 200);
      });
      return;
    }
    
    lastCheckedTime = cur;
    endTimerRAF = requestAnimationFrame(check);
  }
  endTimerRAF = requestAnimationFrame(check);
}

function cancelEndTimer() {
  if (endTimerRAF) {
    cancelAnimationFrame(endTimerRAF);
    endTimerRAF = null;
  }
  lastCheckedTime = 0;
}

// プレイリスト自動再生（改良版）
async function playNextSong() {
  hideTimeEditPopup();
  if (!playlistData.length) return;
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

// トースト通知機能
function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

// ボリューム制御
function initVolumeControl() {
  const volumeSlider = document.getElementById('volumeSlider');
  const volumeDisplay = document.getElementById('volumeDisplay');
  
  volumeSlider.addEventListener('input', (e) => {
    const volume = parseInt(e.target.value);
    setVolume(volume);
    volumeDisplay.textContent = `${volume}%`;
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
    if (event.data === 0) { // 0=終了
      setTimeout(() => playNextSong(), 300);
    }
    if (currentPlayingIdx !== null && event.data === 1) {
      const song = playlistData[currentPlayingIdx];
      if (song) {
        const cur = getCurrentTime();
        const remain = song.end - cur;
        if (remain > 0 && remain < 36000) setEndTimer(song.end);
      }
    }
  });

  document.getElementById('shuffleBtn').onclick = function() {
    shuffleOn = !shuffleOn;
    this.classList.toggle('active', shuffleOn);
    this.title = shuffleOn ? "シャッフル再生中" : "シャッフル再生";
  };
  document.getElementById('videoForm').onsubmit = async (e) => {
    hideTimeEditPopup();
    e.preventDefault();
    cancelEndTimer();
    const input = document.getElementById('ytUrl').value.trim();
    const vid = extractYouTubeId(input);
    if (!vid) { 
      showToast("正しいYouTube URLまたはIDを入力してください"); 
      return; 
    }
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
  document.getElementById('btnExportCSV').onclick = () => {
    hideTimeEditPopup();
    const csv = playlistToCSV();
    const csvBox = document.getElementById('csvTextOutput');
    csvBox.style.display = "block";
    csvBox.value = csv;
    csvBox.select();
    try {
      document.execCommand("copy");
      showToast("CSVをクリップボードにコピーしました");
    } catch {
      showToast("CSV出力完了（手動でコピーしてください）");
    }
    if (window.Blob && window.URL && window.URL.createObjectURL) {
      const now = new Date();
      const y = now.getFullYear(), m = ("0"+(now.getMonth()+1)).slice(-2), d = ("0"+now.getDate()).slice(-2);
      const defaultName = `utawakuwaku_playlist_${y}${m}${d}.csv`;
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 500);
      showToast("CSVファイルをダウンロードしました");
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
    cancelEndTimer();
    stopVideo();
    currentPlayingIdx = null;
    renderCurrentPlaylist();
    document.getElementById('btnPlayPause').textContent = "▶";
  };
  document.getElementById('btnNext').onclick = playNextSong;
  document.getElementById('btnPrev').onclick = playPrevSong;
  
  // プレイリストリセットボタン
  document.getElementById('btnResetPlaylist').onclick = async () => {
    hideTimeEditPopup();
    if (confirm('プレイリストをデフォルトに戻しますか？\n現在のプレイリストは失われます。')) {
      const count = await resetToDefaultPlaylist();
      currentPlayingIdx = null;
      cancelEndTimer();
      stopVideo();
      renderCurrentPlaylist();
      resetForm();
      document.getElementById('btnPlayPause').textContent = "▶";
      showToast(`デフォルトプレイリスト（${count}曲）を読み込みました`);
    }
  };
});

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
