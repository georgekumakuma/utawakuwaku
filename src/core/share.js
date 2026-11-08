// プレイリスト共有URL
//   #p3=<deflate 圧縮テキストの base64url>   … 最新形式（短い。配信タイトルは含めず、取り込み後に YouTube から補う）
//   #pl2=<deflate 圧縮 JSON の base64url>   … 旧形式（読み込みのみ互換）
//   #pl=<CSV の base64url>                  … 旧形式（読み込みのみ互換）

import { csvToSongs } from './csv.js';
import { normalizeSong } from './model.js';

function toB64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

const hasCompression = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

function unpack(rows) {
  return rows.map(r => normalizeSong({
    videoId: r[0], title: r[1], start: r[2], end: r[3], rating: r[4], article: r[5],
    artist: r[6], singer: r[7], tags: r[8], note: r[9]
  })).filter(Boolean);
}

// ===== p3: 短い共有形式 =====
// 1行目: JSON ヘッダー {n: 名前, d?: 10(0.1秒単位)}
// 2行目: 動画IDを連結（11文字ずつ）
// 3行目以降: 1曲1行 「動画番号,開始,長さ,評価,曲名」（数値は36進数、長さ空欄=動画の最後まで）
//   曲名が「動画ID_1h02m03s」形式の自動名なら "~"、記号で始まる・拡張列があるときは JSON 配列
const ID_LEN = 11;

export function autoSceneTitle(videoId, start) {
  const t = Math.floor(start || 0);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${videoId}_${h ? `${h}h${p2(m)}m` : `${m}m`}${p2(sec)}s`;
}

function packText({ name, songs }) {
  const ids = [];
  const index = new Map();
  for (const s of songs) if (!index.has(s.videoId)) { index.set(s.videoId, ids.length); ids.push(s.videoId); }
  const fine = songs.some(s => s.start % 1 || s.end % 1);
  const k = fine ? 10 : 1;
  const num = (v) => Math.round(v * k).toString(36);
  const head = fine ? { n: name || '', d: 10 } : { n: name || '' };
  const lines = songs.map(s => {
    const dur = s.end > s.start ? num(s.end - s.start) : '';
    const extra = s.artist || s.singer || (s.tags && s.tags.length) || s.note;
    let t = s.title || '';
    if (extra || /^[[~]/.test(t) || /[\r\n]/.test(t)) t = JSON.stringify([t, s.artist || '', s.singer || '', (s.tags || []).join(' '), s.note || '']);
    else if (t && t === autoSceneTitle(s.videoId, s.start)) t = '~';
    return [index.get(s.videoId).toString(36), num(s.start), dur, s.rating ?? 3, t].join(',');
  });
  return [JSON.stringify(head), ids.join(''), ...lines].join('\n');
}

function unpackText(text) {
  const lines = text.split('\n');
  const head = JSON.parse(lines[0] || '{}');
  const k = head.d || 1;
  const idStr = lines[1] || '';
  const ids = [];
  for (let i = 0; i < idStr.length; i += ID_LEN) ids.push(idStr.slice(i, i + ID_LEN));
  const songs = [];
  for (const line of lines.slice(2)) {
    const parts = line.split(',');
    if (parts.length < 5) continue;
    const videoId = ids[parseInt(parts[0], 36)];
    if (!videoId) continue;
    const start = parseInt(parts[1], 36) / k;
    const end = parts[2] ? start + parseInt(parts[2], 36) / k : 0;
    let title = parts.slice(4).join(','), artist = '', singer = '', tags = '', note = '';
    if (title === '~') title = autoSceneTitle(videoId, start);
    else if (title.startsWith('[')) { try { [title, artist, singer, tags, note] = JSON.parse(title); } catch { /* そのまま */ } }
    const song = normalizeSong({ videoId, title, start, end, rating: parts[3], artist, singer, tags, note });
    if (song) songs.push(song);
  }
  return { name: head.n || '', songs };
}

export async function encodeShare({ name, songs }) {
  const bytes = new TextEncoder().encode(packText({ name, songs }));
  if (hasCompression) return '#p3=' + toB64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
  return '#p3u=' + toB64Url(bytes);
}

/** 文字列（URL / hash）が共有プレイリストなら hash 部分を返す */
export function shareHashOf(text) {
  const m = String(text || '').trim().match(/#(p3u?|pl2u?|pl)=[A-Za-z0-9_-]+/);
  return m ? m[0] : null;
}

// hash（"#p3=..." / "#pl2=..." / "#pl=..."）→ { name, songs } または null
export async function decodeShare(hash) {
  if (!hash) return null;
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  try {
    if (h.startsWith('p3=')) {
      if (!hasCompression) throw new Error('このブラウザは圧縮形式の共有URLに対応していません');
      return unpackText(new TextDecoder().decode(await pipe(fromB64Url(h.slice(3)), new DecompressionStream('deflate-raw'))));
    }
    if (h.startsWith('p3u=')) return unpackText(new TextDecoder().decode(fromB64Url(h.slice(4))));
    if (h.startsWith('pl2=')) {
      if (!hasCompression) throw new Error('このブラウザは圧縮形式の共有URLに対応していません');
      const bytes = await pipe(fromB64Url(h.slice(4)), new DecompressionStream('deflate-raw'));
      const obj = JSON.parse(new TextDecoder().decode(bytes));
      return { name: obj.n || '', songs: unpack(obj.s || []) };
    }
    if (h.startsWith('pl2u=')) {
      const obj = JSON.parse(new TextDecoder().decode(fromB64Url(h.slice(5))));
      return { name: obj.n || '', songs: unpack(obj.s || []) };
    }
    if (h.startsWith('pl=')) {
      const csv = new TextDecoder().decode(fromB64Url(h.slice(3)));
      return { name: '', songs: csvToSongs(csv) };
    }
  } catch (e) {
    console.warn('共有URLの解析に失敗:', e);
    return null;
  }
  return null;
}

export function buildShareUrl(hash, base = typeof location !== 'undefined' ? location.href : '') {
  return base.split('#')[0] + hash;
}
