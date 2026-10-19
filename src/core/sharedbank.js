// 共有バンク: 他の人が公開したプレイリスト（CSV / playlistbank.json）の URL を扱う
//
// 受け付ける URL
// - Googleスプレッドシート「ウェブに公開」の URL（pubhtml / pub?output=csv）
// - Googleスプレッドシートの編集 URL（「リンクを知っている全員が閲覧可」の場合）
// - GitHub のファイル URL（blob → raw に変換）、Gist の raw URL、その他 CSV / JSON を直接返す URL
// Googleドライブのファイル URL は、ブラウザから直接読めないことが多い（CORS）ため変換のうえ試すだけ

import { csvToSongs } from './csv.js';
import { isValidVideoId } from './ytid.js';

// 入力 URL → 実際に fetch する URL と種類
export function normalizeBankUrl(input) {
  const raw = String(input || '').trim();
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname;
  const gidFrom = () => {
    const m = (u.hash + '&' + u.search).match(/[#&?]gid=(\d+)/);
    return m ? m[1] : null;
  };

  if (host === 'docs.google.com' && u.pathname.startsWith('/spreadsheets/')) {
    // 公開URL: /spreadsheets/d/e/{PUB_ID}/pubhtml | /pub?output=csv
    let m = u.pathname.match(/^\/spreadsheets\/d\/e\/([\w-]+)\/(pubhtml|pub)/);
    if (m) {
      const gid = gidFrom();
      const q = new URLSearchParams({ output: 'csv' });
      if (gid) q.set('gid', gid);
      if (u.searchParams.get('single')) q.set('single', 'true');
      return { url: `https://docs.google.com/spreadsheets/d/e/${m[1]}/pub?${q}`, kind: 'gsheet-pub' };
    }
    // 編集URL: /spreadsheets/d/{ID}/edit#gid=0
    m = u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/);
    if (m) {
      const gid = gidFrom() || '0';
      return { url: `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`, kind: 'gsheet-export' };
    }
  }
  if (host === 'drive.google.com') {
    const m = u.pathname.match(/\/file\/d\/([\w-]+)/) || [null, u.searchParams.get('id')];
    if (m[1]) return { url: `https://drive.google.com/uc?export=download&id=${m[1]}`, kind: 'gdrive' };
  }
  if (host === 'github.com') {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (m) return { url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`, kind: 'github' };
  }
  if (host === 'gist.github.com') {
    const m = u.pathname.match(/^\/([^/]+)\/([0-9a-f]+)\/?$/);
    if (m) return { url: `https://gist.githubusercontent.com/${m[1]}/${m[2]}/raw`, kind: 'gist' };
  }
  return { url: u.toString(), kind: 'url' };
}

// 取得したテキストを解釈する
// 戻り値: { kind: 'bank', name, description, presets: [{id,name,description,icon,url}] }
//      | { kind: 'csv', songs }
export function parseBankText(text, baseUrl) {
  const t = String(text || '').replace(/^﻿/, '').trim();
  if (!t) throw new Error('中身が空です');
  if (/^<(!doctype|html)/i.test(t)) {
    throw new Error('CSVではなくWebページが返ってきました。スプレッドシートは「ウェブに公開」してから、そのURLを貼り付けてください');
  }
  if (t.startsWith('{')) {
    let obj;
    try { obj = JSON.parse(t); } catch { throw new Error('JSONの形式が正しくありません'); }
    const list = Array.isArray(obj.presets) ? obj.presets : [];
    const presets = list.filter(p => p && (p.file || p.url)).map((p, i) => ({
      id: String(p.id || p.file || p.url || i),
      name: p.name || p.file || `プレイリスト ${i + 1}`,
      description: p.description || '',
      icon: p.icon || '🎵',
      url: resolve(p.url || p.file, baseUrl)
    }));
    if (!presets.length) throw new Error('playlistbank.json に presets がありません');
    return { kind: 'bank', name: obj.name || obj.title || '', description: obj.description || '', presets };
  }
  const songs = csvToSongs(t).filter(s => isValidVideoId(s.videoId));
  if (!songs.length) throw new Error('曲が見つかりません。1行目が「videoId,title,start,end,…」になっているか確認してください');
  return { kind: 'csv', songs };
}

function resolve(ref, base) {
  const n = normalizeBankUrl(ref);
  if (n && /^https?:/.test(String(ref))) return n.url;
  try { return new URL(ref, base).toString(); } catch { return String(ref); }
}

// 取得に失敗したときの、利用者向けの説明
export function explainFetchError(kind, status) {
  if (kind === 'gdrive') {
    return 'Googleドライブのファイルはブラウザから直接読み込めません。Googleスプレッドシートに貼り付けて「ウェブに公開」したURLを使ってください';
  }
  if (kind === 'gsheet-export') {
    return 'スプレッドシートを読み込めませんでした。「ファイル」→「共有」→「ウェブに公開」でCSV形式で公開し、表示されたURLを貼り付けてください';
  }
  if (status === 404) return 'URLが見つかりません（404）。公開が取り消されたか、URLが間違っている可能性があります';
  if (status) return `読み込めませんでした（HTTP ${status}）`;
  return '読み込めませんでした。URLが公開されているか、ネットワークに接続しているか確認してください';
}

// スプレッドシートにそのまま貼り付けられる形式（タブ区切り）
export function songsToTSV(songs) {
  const clean = (v) => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ');
  const rows = [['videoId', 'title', 'start', 'end', 'rating', 'article', 'artist', 'singer', 'tags', 'note']];
  for (const s of songs) {
    rows.push([s.videoId, s.title, s.start, s.end, s.rating, s.article, s.artist, s.singer, (s.tags || []).join(' '), s.note].map(clean));
  }
  return rows.map(r => r.join('\t')).join('\n');
}

export const TEMPLATE_CSV = 'videoId,title,start,end,rating,article,artist,singer,tags,note\n'
  + 'uvNqgBWckp4,三年目の浮気,14:21,18:16,5,【歌枠】クリスマスパーティーのために歌の練習してからお話！【雑談】,,,,ここに曲を追加していきます\n';
