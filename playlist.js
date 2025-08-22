// playlist.js
// プレイリスト管理・CSV・描画モジュール

export const CSV_HEADER = "videoId,title,start,end,rating,article";

// デフォルトプレイリスト
const defaultPlaylist = [
  {
    videoId: "dQw4w9WgXcQ",
    title: "Never Gonna Give You Up",
    start: 0,
    end: 60,
    rating: 5,
    article: "Rick Astley - 定番の名曲"
  },
  {
    videoId: "kJQP7kiw5Fk",
    title: "Despacito",
    start: 30,
    end: 90,
    rating: 4,
    article: "Luis Fonsi ft. Daddy Yankee - 世界的ヒット曲"
  },
  {
    videoId: "fJ9rUzIMcZQ",
    title: "Bohemian Rhapsody",
    start: 60,
    end: 180,
    rating: 6,
    article: "Queen - 伝説的な楽曲"
  },
  {
    videoId: "JGwWNGJdvx8",
    title: "Shape of You",
    start: 15,
    end: 75,
    rating: 4,
    article: "Ed Sheeran - ポップスの代表曲"
  }
];

export let playlistData = [...defaultPlaylist];

// プレイリストの初期化（ローカルストレージから読み込み、なければデフォルト使用）
export function initializePlaylist() {
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
  
  // デフォルトプレイリストを使用
  playlistData = [...defaultPlaylist];
  savePlaylistToStorage(); // デフォルトを保存
  return false; // デフォルトデータを使用
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
export function resetToDefaultPlaylist() {
  playlistData = [...defaultPlaylist];
  savePlaylistToStorage();
  return playlistData.length;
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

// プレイリストをHTMLで描画（改良版：現代的UI）
export function renderPlaylist({ 
  ulId = "playlist", 
  currentPlayingIdx = null, 
  onPlay, 
  onEdit, 
  onDelete 
}) {
  const ul = document.getElementById(ulId);
  ul.innerHTML = '';
  
  if (playlistData.length === 0) {
    ul.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-muted);">
        <div style="font-size: 48px; margin-bottom: 16px;">🎵</div>
        <p>プレイリストが空です</p>
        <p style="font-size: 14px;">上記のフォームから曲を追加してください</p>
      </div>
    `;
    return;
  }

  playlistData.forEach((song, idx) => {
    const li = document.createElement('li');
    li.className = 'playlist-item' + (idx === currentPlayingIdx ? ' playing' : '');
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
