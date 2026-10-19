// プレイリストバンク（同梱プリセット）
// 定義: playlists/samples/playlistbank.json  { presets: [{id, name, description, file, icon}] }

import { csvToSongs } from '../core/csv.js';

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
