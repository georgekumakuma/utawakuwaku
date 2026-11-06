// 永続化: IndexedDB（使えなければ localStorage）
// キー: 'data'（プレイリスト群）, 'settings', 'history'

const DB_NAME = 'utawakuwaku';
const DB_VERSION = 1;
const STORE = 'kv';
const LS_PREFIX = 'utawakuwaku_v3_';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function idbGet(key) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

function idbSet(key, value) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function lsGet(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : undefined;
  } catch { return undefined; }
}

function lsSet(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); return true; }
  catch { return false; }
}

export async function load(key) {
  try {
    const v = await idbGet(key);
    if (v !== undefined) return v;
  } catch { /* fallback */ }
  return lsGet(key);
}

export async function save(key, value) {
  // JSON 経由で複製し、Set/関数などが混入しないようにする
  const plain = JSON.parse(JSON.stringify(value));
  try {
    await idbSet(key, plain);
    return true;
  } catch {
    return lsSet(key, plain);
  }
}

// 旧バージョンの localStorage データ
export function loadLegacy() {
  try {
    const v2 = localStorage.getItem('utawakuwaku_playlists_v2');
    if (v2) return { kind: 'v2', value: JSON.parse(v2) };
    const v1 = localStorage.getItem('utawakuwaku_playlist');
    if (v1) return { kind: 'v1', value: JSON.parse(v1) };
  } catch { /* ignore */ }
  return null;
}

// 永続化容量の確保（モバイルブラウザで勝手に消されにくくする）
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch { /* ignore */ }
  return false;
}
