// playlist.js
// プレイリスト管理・CSV・描画モジュール

export const CSV_HEADER = "videoId,title,start,end,rating,article";

export let playlistData = [];

export function setPlaylistData(arr) {
  playlistData = arr;
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

// プレイリストをHTMLで描画
export function renderPlaylist({ 
  ulId = "playlist", 
  currentPlayingIdx = null, 
  onPlay, 
  onEdit, 
  onDelete 
}) {
  const ul = document.getElementById(ulId);
  ul.innerHTML = '';
  playlistData.forEach((song, idx) => {
    const li = document.createElement('li');
    li.className = 'playlist-item' + (idx === currentPlayingIdx ? ' playing' : '');
    li.tabIndex = 0;
    li.draggable = true;
    li.setAttribute("data-idx", idx);

    // ★「▶ボタン」削除、編集ボタンは大きいアイコン
    li.innerHTML = `
      <span class="meta-title" title="${song.title}">${song.title}</span>
      <span class="meta-article" title="${song.article||''}">${song.article||''}</span>
      <span class="meta-video">${song.videoId}</span>
      <span class="meta-range">${formatTime(song.start)}～${formatTime(song.end)}</span>
      <span class="meta-rating">${ratingIcons(song.rating)}</span>
      <span class="playlist-controls">
        <button title="編集" class="edit-btn">&#9998;</button>
        <button title="削除">&#10006;</button>
      </span>
    `;

    // 編集ボタン大きく
    const editBtn = li.querySelector('button[title="編集"]');
    editBtn.style.fontSize = "1.45em"; // 標準1em→1.45emに拡大
    editBtn.style.padding = "0 8px";

    // 各操作イベント
    // 再生はli全体クリック
    li.onclick = () => { onPlay && onPlay(idx); };
    editBtn.onclick = (e) => { e.stopPropagation(); onEdit && onEdit(idx); };
    li.querySelector('button[title="削除"]').onclick = (e) => { e.stopPropagation(); onDelete && onDelete(idx); };
    ul.appendChild(li);
  });

  // --- ドラッグ&ドロップ機能はそのまま ---
  let draggedIdx = null;
  ul.ondragstart = function(e) {
    const li = e.target.closest('.playlist-item');
    if (!li) return;
    draggedIdx = parseInt(li.getAttribute('data-idx'));
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = "move";
  };
  ul.ondragover = function(e) {
    e.preventDefault();
    const li = e.target.closest('.playlist-item');
    if (!li) return;
    li.style.borderTop = "2.5px solid #67d1fa";
  };
  ul.ondragleave = function(e) {
    const li = e.target.closest('.playlist-item');
    if (!li) return;
    li.style.borderTop = "";
  };
  ul.ondrop = function(e) {
    e.preventDefault();
    const li = e.target.closest('.playlist-item');
    if (!li || draggedIdx === null) return;
    const dropIdx = parseInt(li.getAttribute('data-idx'));
    if (dropIdx !== draggedIdx) {
      const moved = playlistData.splice(draggedIdx, 1)[0];
      playlistData.splice(dropIdx, 0, moved);
      if (typeof window.renderCurrentPlaylist === "function") {
        window.renderCurrentPlaylist();
      }
    }
    draggedIdx = null;
    document.querySelectorAll('.playlist-item').forEach(li => li.style.borderTop = "");
  };
  ul.ondragend = function(e) {
    draggedIdx = null;
    document.querySelectorAll('.playlist-item').forEach(li => li.classList.remove('dragging'));
    document.querySelectorAll('.playlist-item').forEach(li => li.style.borderTop = "");
  };
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
