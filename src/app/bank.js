// プレイリストバンク（同梱プリセット）
// 定義: playlists/samples/playlistbank.json  { presets: [{id, name, description, file, icon}] }

import { csvToSongs, parseCSVRows } from '../core/csv.js';
import { normalizeBankUrl, parseBankText, explainFetchError } from '../core/sharedbank.js';

const cache = new Map();

export async function listBankPresets() {
  try {
    const res = await fetch('./playlists/samples/playlistbank.json', { cache: 'no-cache' });
    if (res.ok) {
      const bank = await res.json();
      if (bank && Array.isArray(bank.presets)) {
        return bank.presets.filter(p => p && p.file).map(p => ({
          id: p.id || p.file, name: p.name || p.file, description: p.description || '',
          file: p.file, icon: p.icon || '🎵'
        }));
      }
    }
  } catch (e) {
    console.warn('playlistbank.json の取得に失敗:', e);
  }
  return [];
}

export async function fetchBankCSV(file) {
  if (cache.has(file)) return cache.get(file).map(s => ({ ...s, id: undefined }));
  // samples/ に無ければ playlists/ 直下（デフォルトCSV）も探す
  for (const base of ['./playlists/samples/', './playlists/']) {
    try {
      const res = await fetch(base + encodeURIComponent(file));
      if (res.ok) {
        const songs = csvToSongs(await res.text());
        if (songs.length) { cache.set(file, songs); return songs.map(s => ({ ...s, id: undefined })); }
      }
    } catch { /* 次を試す */ }
  }
  throw new Error(`CSVを取得できませんでした: ${file}`);
}

export async function countBankCSV(file) {
  try { return (await fetchBankCSV(file)).length; } catch { return null; }
}

// ===== 共有バンク =====

async function fetchText(rawUrl) {
  const n = normalizeBankUrl(rawUrl);
  if (!n) throw new Error('URLの形式が正しくありません（https:// で始まるURLを貼り付けてください）');
  let res;
  try {
    res = await fetch(n.url, { cache: 'no-cache', redirect: 'follow' });
  } catch {
    throw new Error(explainFetchError(n.kind, 0));
  }
  if (!res.ok) throw new Error(explainFetchError(n.kind, res.status));
  return { text: await res.text(), url: res.url || n.url, kind: n.kind };
}

// URL の中身を調べる（登録前の確認用）。
// 戻り値: { kind: 'bank', name, description, presets } | { kind: 'csv', songs }
export async function inspectSharedUrl(rawUrl) {
  const { text, url } = await fetchText(rawUrl);
  return parseBankText(text, url);
}

// バンク内のプレイリスト（または CSV そのもの）の曲を取得
export async function fetchSharedSongs(rawUrl) {
  const r = await inspectSharedUrl(rawUrl);
  if (r.kind !== 'csv') throw new Error('このURLはプレイリストではなくバンク（一覧）です');
  return r.songs;
}

// みんなの共有バンク（作者が掲載を承認した一覧）
// playlists/shared-directory.json の banks と、任意の Googleフォーム回答シート（公開CSV）を合わせる。
// シートは「掲載」列に ○ が付いた行だけを表示する（列が無ければ何も表示しない）
const APPROVED = new Set(['○', '〇', 'o', 'yes', 'y', 'true', '1', '掲載', 'ok']);
export async function listDirectory() {
  let dir;
  try {
    const res = await fetch('./playlists/shared-directory.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    dir = await res.json();
  } catch { return []; }
  const out = (Array.isArray(dir.banks) ? dir.banks : []).filter(b => b && b.url).map(b => ({
    name: b.name || '共有バンク', description: b.description || '', url: b.url, author: b.author || '', icon: b.icon || '📚'
  }));
  if (dir.sheet) {
    try {
      const { text } = await fetchText(dir.sheet);
      const rows = parseCSVRows(text);
      const head = (rows.shift() || []).map(x => x.trim().toLowerCase());
      const col = (names) => head.findIndex(x => names.some(n => x.includes(n)));
      const ci = { name: col(['name', '名前', 'バンク名']), url: col(['url']), desc: col(['description', '説明']), author: col(['author', '作成者', '公開者']), ok: col(['approved', '掲載']) };
      for (const r of rows) {
        const url = ci.url >= 0 ? (r[ci.url] || '').trim() : '';
        if (!url || !normalizeBankUrl(url)) continue;
        if (ci.ok < 0 || !APPROVED.has((r[ci.ok] || '').trim().toLowerCase())) continue;
        if (out.some(b => b.url === url)) continue;
        out.push({ name: (r[ci.name] || '').trim() || '共有バンク', description: ci.desc >= 0 ? r[ci.desc] || '' : '', url, author: ci.author >= 0 ? r[ci.author] || '' : '', icon: '📚' });
      }
    } catch (e) { console.warn('共有バンク一覧シートの取得に失敗:', e); }
  }
  return out;
}
