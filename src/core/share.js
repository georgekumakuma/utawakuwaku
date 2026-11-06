// プレイリスト共有URL
//   #pl2=<deflate 圧縮 JSON の base64url>   … 新形式（圧縮、曲名・評価・拡張列を含む）
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

// コンパクトな配列表現にする（キー名を省いてサイズ削減）
function pack(songs) {
  return songs.map(s => {
    const row = [s.videoId, s.title, s.start, s.end, s.rating, s.article || ''];
    if (s.artist || s.singer || (s.tags && s.tags.length) || s.note) {
      row.push(s.artist || '', s.singer || '', (s.tags || []).join(' '), s.note || '');
    }
    return row;
  });
}

function unpack(rows) {
  return rows.map(r => normalizeSong({
    videoId: r[0], title: r[1], start: r[2], end: r[3], rating: r[4], article: r[5],
    artist: r[6], singer: r[7], tags: r[8], note: r[9]
  })).filter(Boolean);
}

export async function encodeShare({ name, songs }) {
  const payload = JSON.stringify({ v: 2, n: name || '', s: pack(songs) });
  const bytes = new TextEncoder().encode(payload);
  if (hasCompression) {
    const z = await pipe(bytes, new CompressionStream('deflate-raw'));
    return '#pl2=' + toB64Url(z);
  }
  return '#pl2u=' + toB64Url(bytes);
}

// hash（"#pl2=..." / "#pl=..."）→ { name, songs } または null
export async function decodeShare(hash) {
  if (!hash) return null;
  const h = hash.startsWith('#') ? hash.slice(1) : hash;
  try {
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
