// playlist.js
// プレイリスト管理・CSV・描画モジュール

export const CSV_HEADER = "videoId,title,start,end,rating,article";

export let playlistData = [];

// プレイリストバンク（プリセット一覧）のキャッシュ
let playlistBankData = null;

// プレイリストバンクを読み込む
export async function loadPlaylistBank() {
  if (playlistBankData) return playlistBankData;
  
  try {
    const response = await fetch('./playlists/playlist-bank.json');
    if (response.ok) {
      playlistBankData = await response.json();
      return playlistBankData;
    }
  } catch (e) {
    console.warn('プレイリストバンクの読み込みに失敗:', e);
  }
  
  // フォールバック: デフォルトプリセットのみ
  playlistBankData = {
    version: "1.0",
    presets: [{
      id: "default",
      name: "デフォルト",
      description: "おすすめの曲を集めたプレイリスト",
      file: "utawakuwaku_playlist_default.csv",
      icon: "⭐"
    }]
  };
  return playlistBankData;
}

// 指定したプリセットを読み込む
export async function loadPresetPlaylist(presetId) {
  const bank = await loadPlaylistBank();
  const preset = bank.presets.find(p => p.id === presetId);
  
  if (!preset) {
    throw new Error(`プリセット「${presetId}」が見つかりません`);
  }
  
  const response = await fetch(`./playlists/${preset.file}`);
  if (!response.ok) {
    throw new Error(`プレイリストファイルの読み込みに失敗: ${preset.file}`);
  }
  
  const csvText = await response.text();
  const loadedPlaylist = csvToPlaylist(csvText);
  
  if (loadedPlaylist.length === 0) {
    throw new Error('プレイリストが空です');
  }
  
  playlistData = loadedPlaylist;
  savePlaylistToStorage();
  
  return {
    preset: preset,
    count: loadedPlaylist.length
  };
}

// プレイリストの初期化（ローカルストレージから読み込み、なければデフォルトCSVから読み込み）
export async function initializePlaylist() {
  try {
    const saved = localStorage.getItem('utawakuwaku_playlist');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        playlistData = parsed;
        return true; // 既存データを読み込み
      }
    }
  } catch (e) {
    console.warn('ローカルストレージからの読み込みに失敗:', e);
  }
  
  // デフォルトCSVファイルから読み込み
  try {
    const response = await fetch('./playlists/utawakuwaku_playlist_default.csv');
    if (response.ok) {
      const csvText = await response.text();
      const defaultPlaylist = csvToPlaylist(csvText);
      if (defaultPlaylist.length > 0) {
        playlistData = defaultPlaylist;
        savePlaylistToStorage(); // デフォルトを保存
        return false; // デフォルトデータを使用
      }
    }
  } catch (e) {
    console.warn('デフォルトCSVファイルの読み込みに失敗:', e);
  }
  
  // 最後の手段として空のプレイリスト
  playlistData = [];
  return false;
}

// プレイリストをローカルストレージに保存
export function savePlaylistToStorage() {
  try {
    localStorage.setItem('utawakuwaku_playlist', JSON.stringify(playlistData));
  } catch (e) {
    console.warn('ローカルストレージへの保存に失敗:', e);
  }
}

export function setPlaylistData(arr) {
  playlistData = arr;
  savePlaylistToStorage(); // 自動保存
}

// デフォルトプレイリストに戻す
export async function resetToDefaultPlaylist() {
  try {
    const response = await fetch('./playlists/utawakuwaku_playlist_default.csv');
    if (response.ok) {
      const csvText = await response.text();
      const defaultPlaylist = csvToPlaylist(csvText);
      if (defaultPlaylist.length > 0) {
        playlistData = defaultPlaylist;
        savePlaylistToStorage();
        return playlistData.length;
      }
    }
  } catch (e) {
    console.warn('デフォルトCSVファイルの読み込みに失敗:', e);
  }
  
  // CSVファイルの読み込みに失敗した場合は空にする
  playlistData = [];
  savePlaylistToStorage();
  return 0;
}

export function playlistToCSV(arr = playlistData) {
  const lines = [CSV_HEADER];
  arr.forEach(item => {
    lines.push([
      escapeCSV(item.videoId),
      escapeCSV(item.title),
      toIntSec(item.start),
      toIntSec(item.end),
      item.rating,
      escapeCSV(item.article)
    ].join(','));
  });
  return lines.join('\n');
}

export function csvToPlaylist(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length || !lines[0].toLowerCase().startsWith('videoid')) return [];
  return lines.slice(1).filter(line=>!!line.trim()).map(line=>{
    let cols = [];
    let q = false, col = '';
    for (let i = 0; i < line.length; ++i) {
      const c = line[i];
      if (c === '"' && line[i+1]==='"') { col+='"'; ++i; }
      else if (c === '"') q = !q;
      else if (c === ',' && !q) { cols.push(col); col = ''; }
      else col += c;
    }
    cols.push(col);
    return {
      videoId: unescapeCSV(cols[0]||""),
      title: unescapeCSV(cols[1]||""),
      start: toIntSec(cols[2]),
      end: toIntSec(cols[3]),
      rating: parseInt(cols[4])||1,
      article: unescapeCSV(cols[5]||"")
    };
  });
}

// プレイリストをHTMLで描画（改良版：現代的UI + 編集状態表示）
export function renderPlaylist({ 
  ulId = "playlist", 
  currentPlayingIdx = null, 
  editingIdx = null,
  onPlay, 
  onEdit, 
  onDelete 
}) {
  const ul = document.getElementById(ulId);
  ul.innerHTML = '';
  
  if (playlistData.length === 0) {
    ul.innerHTML = `
      <div style="text-align: center; padding: 30px; color: var(--text-muted);">
        <div style="font-size: 48px; margin-bottom: 12px;">🎵</div>
        <p>プレイリストが空です</p>
        <p style="font-size: 12px;">上記のフォームから曲を追加してください</p>
      </div>
    `;
    return;
  }

  playlistData.forEach((song, idx) => {
    const li = document.createElement('li');
    let className = 'playlist-item';
    if (idx === currentPlayingIdx) className += ' playing';
    if (idx === editingIdx) className += ' editing';
    
    li.className = className;
    li.tabIndex = 0;
    li.draggable = true;
    li.setAttribute("data-idx", idx);

    li.innerHTML = `
      <div class="playlist-number">${(idx + 1).toString().padStart(2, '0')}</div>
      <div class="playlist-content">
        <div class="meta-title" title="${escapeHtml(song.title)}">${escapeHtml(song.title)}</div>
        <div class="meta-article" title="${escapeHtml(song.article||'')}">${escapeHtml(song.article||'')}</div>
        <div class="meta-video">${song.videoId}</div>
        <div class="meta-range">${formatTime(song.start)}～${formatTime(song.end)}</div>
        <div class="meta-rating">${ratingIcons(song.rating)}</div>
      </div>
      <div class="playlist-controls">
        <button class="btn btn-secondary btn-icon edit-btn" title="編集">✏️</button>
        <button class="btn btn-secondary btn-icon delete-btn" title="削除">🗑️</button>
      </div>
      ${idx === currentPlayingIdx ? '<div class="now-playing-indicator">PLAYING</div>' : ''}
      ${idx === editingIdx ? '<div class="editing-indicator">EDITING</div>' : ''}
    `;

    // 各操作イベント
    const editBtn = li.querySelector('.edit-btn');
    const deleteBtn = li.querySelector('.delete-btn');
    
    // プレイリスト項目クリックで再生
    li.addEventListener('click', (e) => {
      if (!e.target.closest('.playlist-controls')) {
        onPlay && onPlay(idx);
      }
    });
    
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onEdit && onEdit(idx);
    });
    
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onDelete && onDelete(idx);
    });
    
    ul.appendChild(li);
  });

  // ドラッグ&ドロップ機能
  setupDragAndDrop(ul);
}

function setupDragAndDrop(ul) {
  let draggedIdx = null;
  
  ul.addEventListener('dragstart', function(e) {
    const li = e.target.closest('.playlist-item');
    if (!li) return;
    draggedIdx = parseInt(li.getAttribute('data-idx'));
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = "move";
  });
  
  ul.addEventListener('dragover', function(e) {
    e.preventDefault();
    const li = e.target.closest('.playlist-item');
    if (!li) return;
    li.style.borderTop = "3px solid var(--accent-primary)";
  });
  
  ul.addEventListener('dragleave', function(e) {
    const li = e.target.closest('.playlist-item');
    if (!li) return;
    li.style.borderTop = "";
  });
  
  ul.addEventListener('drop', function(e) {
    e.preventDefault();
    const li = e.target.closest('.playlist-item');
    if (!li || draggedIdx === null) return;
    const dropIdx = parseInt(li.getAttribute('data-idx'));
    if (dropIdx !== draggedIdx) {
      const moved = playlistData.splice(draggedIdx, 1)[0];
      playlistData.splice(dropIdx, 0, moved);
      savePlaylistToStorage(); // 自動保存
      if (typeof window.renderCurrentPlaylist === "function") {
        window.renderCurrentPlaylist();
      }
    }
    draggedIdx = null;
    document.querySelectorAll('.playlist-item').forEach(li => li.style.borderTop = "");
  });
  
  ul.addEventListener('dragend', function(e) {
    draggedIdx = null;
    document.querySelectorAll('.playlist-item').forEach(li => {
      li.classList.remove('dragging');
      li.style.borderTop = "";
    });
  });
}

function escapeCSV(val) {
  if (typeof val !== "string") return val;
  if (val.includes(",") || val.includes("\"") || val.includes("\n"))
    return '"' + val.replace(/"/g, '""') + '"';
  return val;
}

function unescapeCSV(val) {
  if (val.startsWith('"') && val.endsWith('"')) {
    return val.slice(1, -1).replace(/""/g, '"');
  }
  return val;
}

function toIntSec(val) { return Math.floor(parseFloat(val) || 0); }

function formatTime(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}` : `${m}:${s.toString().padStart(2,'0')}`;
}

function ratingIcons(val) {
  let stars = '';
  for (let i = 1; i <= 6; ++i)
    stars += `<span class="star s${i}">${i <= val ? "★" : "☆"}</span>`;
  return stars;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
