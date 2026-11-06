// 原曲の長さの検索（Apple の iTunes Search API。無料・キー不要）
// - 1分あたり約20回の制限があるため、1件ずつ間隔を空けて問い合わせ、制限にかかったら待って再試行
// - 結果は端末に保存して、同じ曲を二度調べない（見つからなかった曲も30日間は覚えておく）
// - ブラウザが直接の読み込みを許さない場合は JSONP（script タグ）に切り替える

import * as storage from '../core/storage.js';
import { pickTrack, searchTerm, cacheKey } from '../core/tracklen.js';

const ENDPOINT = 'https://itunes.apple.com/search';
const MISS_TTL = 30 * 86400000;
const BASE_GAP = 300;
const SLOW_GAP = 3200;

let cache = null;
let saveTimer = null;
let mode = 'fetch';
let gap = BASE_GAP;
let lastCall = 0;
let jsonpSeq = 0;

async function loadCache() {
  if (!cache) {
    const raw = await storage.load('tracklen');
    cache = new Map(Object.entries(raw && typeof raw === 'object' ? raw : {}));
  }
  return cache;
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => storage.save('tracklen', Object.fromEntries(cache)), 600);
}

function params(term) {
  return new URLSearchParams({ term, country: 'JP', media: 'music', entity: 'song', limit: '15', lang: 'ja_jp' });
}

class RateLimited extends Error {}

async function viaFetch(term) {
  const res = await fetch(`${ENDPOINT}?${params(term)}`);
  if (res.status === 403 || res.status === 429) throw new RateLimited('rate limited');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

function viaJsonp(term, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const cb = `__utaTrack${Date.now().toString(36)}${jsonpSeq++}`;
    const script = document.createElement('script');
    const done = () => { clearTimeout(timer); delete window[cb]; script.remove(); };
    const timer = setTimeout(() => { done(); reject(new RateLimited('timeout')); }, timeout);
    window[cb] = (data) => { done(); resolve((data && data.results) || []); };
    script.onerror = () => { done(); reject(new RateLimited('script error')); };
    const p = params(term);
    p.set('callback', cb);
    script.src = `${ENDPOINT}?${p}`;
    document.head.appendChild(script);
  });
}

async function search(term) {
  const wait = lastCall + gap - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
  if (mode === 'fetch') {
    try {
      return await viaFetch(term);
    } catch (e) {
      if (e instanceof RateLimited) throw e;
      if (!(e instanceof TypeError)) throw e;
      mode = 'jsonp'; // CORS で弾かれた（またはネットワーク不調）→ JSONP で再試行
    }
  }
  return viaJsonp(term);
}

async function searchWithRetry(term) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await search(term);
      if (attempt === 0 && gap > BASE_GAP) gap = Math.max(BASE_GAP, gap - 400);
      return r;
    } catch (e) {
      if (!(e instanceof RateLimited) || attempt === 2) throw e;
      gap = SLOW_GAP;
      await new Promise(r => setTimeout(r, 4000 * (attempt + 1)));
    }
  }
  return [];
}

// 1曲ぶん: { seconds, trackName, artistName } / { miss: true } / 例外（通信できない）
export async function lookupTrack(song) {
  const c = await loadCache();
  const key = cacheKey(song);
  const hit = c.get(key);
  if (hit && (!hit.miss || Date.now() - hit.at < MISS_TTL)) return hit;
  let found = pickTrack(await searchWithRetry(searchTerm(song)), song);
  if (!found && song.artist) found = pickTrack(await searchWithRetry(searchTerm({ title: song.title })), { title: song.title });
  const value = found
    ? { seconds: found.seconds, trackName: found.trackName, artistName: found.artistName, at: Date.now() }
    : { miss: true, at: Date.now() };
  c.set(key, value);
  persist();
  return value;
}

// 複数曲を順番に調べる。onResult(index, info | { error })。isCancelled() が true なら中断
export async function lookupMany(songs, { onResult, isCancelled = () => false } = {}) {
  for (let i = 0; i < songs.length; i++) {
    if (isCancelled()) return;
    const s = songs[i];
    if (!s || !s.title) { onResult && onResult(i, { miss: true }); continue; }
    try {
      onResult && onResult(i, await lookupTrack(s));
    } catch (e) {
      onResult && onResult(i, { error: e.message || 'error' });
    }
  }
}
