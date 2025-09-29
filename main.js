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

// グローバル状態
let currentPlayingIdx = null;
let editingIndex = -1;
let selectedRating = 1;
let shuffleOn = false;
let editingTitleOriginal = "";
let pendingSeekSec = null;
let pendingEndSec = null;

// ---- キャッシュ管理＋デフォルトCSV読み込み ----
function savePlaylistToCache() {
  try {
    localStorage.setItem('playlist', playlistToCSV());
  } catch (e) {
    console.error('Failed to save playlist to cache', e);
  }
}

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

// YouTube動画長取得（必要に応じて）
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
      alert("曲名/シーン名を入力してください。");
      return;
    }
    if (!videoId || videoId.length !== 11) {
      alert("動画IDを正しく入力してください。");
      return;
    }
    if (isNaN(start) || isNaN(end) || end < start) {
      alert("開始・終了時間を正しく指定してください。");
      return;
    }

    const song = { videoId, title, start, end, rating, article };

    if (editingIndex >= 0) {
      const curTitle = form.querySelector('#songTitle').value.trim();
      if (curTitle !== editingTitleOriginal) {
        // タイトル変更による「新規追加」モード
        playlistData.push(song);
        editingIndex = -1;
        editingTitleOriginal = "";
        document.getElementById('btnAddSong').textContent = "リストに追加";
      } else {
        // 単に編集しただけ
        playlistData[editingIndex] = song;
        editingIndex = -1;
        editingTitleOriginal = "";
        document.getElementById('btnAddSong').textContent = "リストに追加";
      }
    } else {
      playlistData.push(song);
    }

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
      onOk: (val) => form.querySelector('#startTime').value = val,
      onCancel: () => {}
    });
  };

  form.querySelector('#btnEditEnd').onclick = () => {
    showTimeEditPopup({
      fieldId: 'endTime',
      value: form.querySelector('#endTime').value,
      onOk: (val) => form.querySelector('#endTime').value = val,
      onCancel: () => {}
    });
  };

  form.querySelector('#btnGetCurrent').onclick = () => {
    hideTimeEditPopup();
    form.querySelector('#startTime').value = formatTime(getCurrentTime());
  };
}

// ★タイトル変更時に「新規追加」へ切り替え
function monitorTitleForEdit(form) {
  const titleInput = form.querySelector('#songTitle');
  titleInput.oninput = () => {
    if (editingIndex >= 0 && titleInput.value.trim() !== editingTitleOriginal) {
      document.getElementById('btnAddSong').textContent = "リストに追加";
    } else if (editingIndex >= 0) {
      document.getElementById('btnAddSong').textContent = "更新";
    }
  };
}

// プレイリストを表示
function renderCurrentPlaylist() {
  renderPlaylist({
    ulId: "playlist",
    currentPlayingIdx,
    onPlay: playSongSection,
    onEdit: editSong,
    onDelete: deleteSong
  });
  adjustWindowHeightByPlaylist();
}
window.renderCurrentPlaylist = renderCurrentPlaylist;

// 曲を再生
function playSongSection(idx) {
  hideTimeEditPopup();
  cancelEndTimer();
  const song = playlistData[idx];
  if (!song) return;
  currentPlayingIdx = idx;
  pendingSeekSec = song.start;
  if (song.end > song.start) {
    pendingEndSec = song.end;
  } else {
    pendingEndSec = null;
  }
  setVideo({ videoId: song.videoId, seekSec: 0, endSec: null, autoPlay: true });
  renderCurrentPlaylist();
}

// 編集ボタン：曲情報をフォームへ読み込み
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
  editingTitleOriginal = song.title;
  document.getElementById('btnAddSong').textContent = "更新";
  monitorTitleForEdit(form);
}

// 削除ボタン：曲をリストから消去
function deleteSong(idx) {
  hideTimeEditPopup();
  if (confirm("この曲を削除しますか？")) {
    playlistData.splice(idx, 1);
    renderCurrentPlaylist();
    resetForm();
    if (currentPlayingIdx === idx) {
      currentPlayingIdx = null;
    } else if (currentPlayingIdx > idx) {
      currentPlayingIdx -= 1;
    }
  }
}

// 区間再生タイマー管理
let endTimerRAF = null;
function setEndTimer(endSec) {
  cancelEndTimer();
  function check() {
    const cur = getCurrentTime();
    if (cur >= endSec - 1) {
      pauseVideo();
      cancelEndTimer();
      setTimeout(() => playNextSong(), 300);
      return;
    }
    endTimerRAF = requestAnimationFrame(check);
  }
  endTimerRAF = requestAnimationFrame(check);
}
function cancelEndTimer() {
  if (endTimerRAF) {
    cancelAnimationFrame(endTimerRAF);
    endTimerRAF = null;
  }
}

// プレイリスト自動再生：次/前の曲
function playNextSong() {
  hideTimeEditPopup();
  if (!playlistData.length) return;
  let nextIdx;
  if (shuffleOn) {
    do {
      nextIdx = Math.floor(Math.random() * playlistData.length);
    } while (playlistData.length > 1 && nextIdx === currentPlayingIdx);
  } else {
    nextIdx = (currentPlayingIdx === null) ? 0 :
              (currentPlayingIdx + 1) % playlistData.length;
  }
  playSongSection(nextIdx);
}

function playPrevSong() {
  hideTimeEditPopup();
  if (!playlistData.length) return;
  let prevIdx;
  if (shuffleOn) {
    do {
      prevIdx = Math.floor(Math.random() * playlistData.length);
    } while (playlistData.length > 1 && prevIdx === currentPlayingIdx);
  } else {
    prevIdx = (currentPlayingIdx === null || currentPlayingIdx === 0) ?
              playlistData.length - 1 :
              currentPlayingIdx - 1;
  }
  playSongSection(prevIdx);
}

// 評価スター
function buildRatingStars() {
  const cont = document.getElementById('ratingStars');
  cont.innerHTML = '';
  for (let i = 1; i <= 6; ++i) {
    const span = document.createElement('span');
    span.className = 'star s' + i;
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

// 時間文字列を秒に変換
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
  buildRatingStars();
  await loadPlaylistFromCacheOrDefault();
  renderCurrentPlaylist();
  loadYouTubeAPI();

  // まずフォームのイベントをバインド
  initFormEventListeners(document.getElementById('songForm'));

  // YouTubeプレイヤーの状態変化を監視
  setPlayerStateChangeCallback((event) => {
    const btn = document.getElementById('btnPlayPause');
    if (event.data === YT.PlayerState.PLAYING) {
      btn.textContent = "⏸";
      if (pendingSeekSec !== null) {
        seekTo(pendingSeekSec);
        pendingSeekSec = null;
      }
      if (pendingEndSec !== null) {
        setEndTimer(pendingEndSec);
        pendingEndSec = null;
      }
    } else {
      btn.textContent = "▶";
    }
    if (event.data === YT.PlayerState.ENDED) {
      setTimeout(() => playNextSong(), 300);
    }
  });

  document.getElementById('shuffleBtn').onclick = function () {
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
    if (currentPlayingIdx === null) {
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
    currentPlayingIdx = null;
    renderCurrentPlaylist();
    document.getElementById('btnPlayPause').textContent = "▶";
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
      }, 500);
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
  editingIndex = -1;
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
