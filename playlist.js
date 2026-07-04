// playlist.js
// プレイリスト管理・CSV・描画モジュール

export const CSV_HEADER = "videoId,title,start,end,rating,article";

export let playlistData = [];

// ===== 複数プレイリスト管理 =====
// v2ストア形式: { current: "リスト名", lists: { "リスト名": [songs] } }
const STORE_KEY = 'utawakuwaku_playlists_v2';
const LEGACY_KEY = 'utawakuwaku_playlist';
const DEFAULT_LIST_NAME = 'マイリスト';

let store = { current: DEFAULT_LIST_NAME, lists: {} };

function persistStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('ローカルストレージへの保存に失敗:', e);
  }
}

// プレイリストの初期化
// 優先順位: v2ストア → 旧形式（v1）からの移行 → デフォルトCSV
export async function initializePlaylist() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.lists && Object.keys(parsed.lists).length > 0) {
        store = parsed;
        if (!(store.current in store.lists)) {
          store.current = Object.keys(store.lists)[0];
        }
        playlistData = store.lists[store.current] || [];
        return true;
      }
    }
  } catch (e) {
    console.warn('ローカルストレージからの読み込みに失敗:', e);
  }

  // 旧形式（単一プレイリスト）からの移行
  try {
    const saved = localStorage.getItem(LEGACY_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        store = { current: DEFAULT_LIST_NAME, lists: { [DEFAULT_LIST_NAME]: parsed } };
        playlistData = parsed;
        persistStore();
        return true;
      }
    }
  } catch (e) {
    console.warn('旧形式データの移行に失敗:', e);
  }

  // デフォルトCSVファイルから読み込み
  try {
    const response = await fetch('./playlists/utawakuwaku_playlist_default.csv');
    if (response.ok) {
      const csvText = await response.text();
      const defaultPlaylist = csvToPlaylist(csvText);
      if (defaultPlaylist.length > 0) {
        store = { current: DEFAULT_LIST_NAME, lists: { [DEFAULT_LIST_NAME]: defaultPlaylist } };
        playlistData = defaultPlaylist;
        persistStore();
        return false; // デフォルトデータを使用
      }
    }
  } catch (e) {
    console.warn('デフォルトCSVファイルの読み込みに失敗:', e);
  }

  // 最後の手段として空のプレイリスト
  store = { current: DEFAULT_LIST_NAME, lists: { [DEFAULT_LIST_NAME]: [] } };
  playlistData = [];
  return false;
}

// 現在のプレイリストをローカルストレージに保存
export function savePlaylistToStorage() {
  store.lists[store.current] = playlistData;
  persistStore();
}

export function setPlaylistData(arr) {
  playlistData = arr;
  savePlaylistToStorage(); // 自動保存
}

// ===== プレイリスト管理API =====
export function getPlaylistNames() {
  return Object.keys(store.lists);
}

export function getCurrentPlaylistName() {
  return store.current;
}

export function switchPlaylist(name) {
  if (!(name in store.lists) || name === store.current) return false;
  store.lists[store.current] = playlistData;
  store.current = name;
  playlistData = store.lists[name];
  persistStore();
  return true;
}

// 新規プレイリスト作成（作成後そのリストに切り替える）
export function createPlaylist(name, songs = []) {
  if (!name || name in store.lists) return false;
  store.lists[store.current] = playlistData;
  store.lists[name] = songs;
  store.current = name;
  playlistData = songs;
  persistStore();
  return true;
}

export function renameCurrentPlaylist(newName) {
  if (!newName || newName in store.lists) return false;
  const oldName = store.current;
  store.lists[newName] = playlistData;
  delete store.lists[oldName];
  store.current = newName;
  persistStore();
  return true;
}

// 現在のプレイリストを削除（最後の1つは削除不可）
export function deleteCurrentPlaylist() {
  if (Object.keys(store.lists).length <= 1) return false;
  delete store.lists[store.current];
  store.current = Object.keys(store.lists)[0];
  playlistData = store.lists[store.current];
  persistStore();
  return true;
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

// プレイリストをHTMLで描画（改良版：検索フィルター・ソート・編集状態表示対応）
export function renderPlaylist({
  ulId = "playlist",
  currentPlayingIdx = null,
  editingIdx = null,
  filterText = "",
  sortOrder = "default",
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

  // 検索フィルター（元インデックスを保持したまま絞り込み）
  const query = filterText.toLowerCase().trim();
  let items = playlistData.map((song, idx) => ({ song, idx }));
  if (query) {
    items = items.filter(({ song }) =>
      song.title.toLowerCase().includes(query) ||
      (song.article || '').toLowerCase().includes(query)
    );
  }

  // ソート（元インデックスは変えない）
  if (sortOrder === 'title-asc') {
    items.sort((a, b) => a.song.title.localeCompare(b.song.title, 'ja'));
  } else if (sortOrder === 'title-desc') {
    items.sort((a, b) => b.song.title.localeCompare(a.song.title, 'ja'));
  } else if (sortOrder === 'rating-desc') {
    items.sort((a, b) => b.song.rating - a.song.rating);
  } else if (sortOrder === 'rating-asc') {
    items.sort((a, b) => a.song.rating - b.song.rating);
  }

  if (items.length === 0) {
    ul.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--text-muted);">
        <div style="font-size: 32px; margin-bottom: 8px;">🔍</div>
        <p>「${escapeHtml(filterText)}」に一致する曲がありません</p>
      </div>
    `;
    return;
  }

  items.forEach(({ song, idx }) => {
    const li = document.createElement('li');
    let className = 'playlist-item';
    if (idx === currentPlayingIdx) className += ' playing';
    if (idx === editingIdx) className += ' editing';

    li.className = className;
    li.tabIndex = 0;
    // ソート中はDnD無効（インデックスがずれるため）
    if (sortOrder === 'default' && !query) {
      li.draggable = true;
    }
    li.setAttribute("data-idx", idx);

    // タイトル・説明の検索ハイライト
    const highlightedTitle = query ? highlight(escapeHtml(song.title), query) : escapeHtml(song.title);
    const highlightedArticle = query ? highlight(escapeHtml(song.article || ''), query) : escapeHtml(song.article || '');

    li.innerHTML = `
      <div class="playlist-number">${(idx + 1).toString().padStart(2, '0')}</div>
      <img class="playlist-thumb" loading="lazy" alt=""
           src="https://i.ytimg.com/vi/${encodeURIComponent(song.videoId)}/default.jpg"
           onerror="this.style.visibility='hidden'">
      <div class="playlist-content">
        <div class="meta-title" title="${escapeHtml(song.title)}">${highlightedTitle}</div>
        <div class="meta-article" title="${escapeHtml(song.article||'')}">${highlightedArticle}</div>
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

    const editBtn = li.querySelector('.edit-btn');
    const deleteBtn = li.querySelector('.delete-btn');

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

  // DnDはデフォルト順かつ検索なしの場合のみ有効
  if (sortOrder === 'default' && !query) {
    setupDragAndDrop(ul);
  }
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

// 検索キーワードをハイライト表示（既にescapeHtml済みの文字列を受け取る）
function highlight(escapedHtml, query) {
  if (!query) return escapedHtml;
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escapedHtml.replace(
    new RegExp(`(${escapedQuery})`, 'gi'),
    '<mark style="background:rgba(255,200,0,0.4);border-radius:3px;padding:0 2px;">$1</mark>'
  );
}
