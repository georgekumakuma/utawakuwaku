// YouTube Data API v3（公開情報の読み取りだけ。ログインは使わない）
// - 呼ぶのは利用者が「セトリを探す」を押したときだけ（1回で 1〜2 単位）
// - 取得した概要欄・コメントの文章は保存しない（その場でセットリストに変換するだけ）

import { state } from '../core/store.js';
import * as store from '../core/store.js';
import { YOUTUBE_API_KEY } from './config.js';
import { parseIsoDuration, findSetlists } from '../core/setlistfind.js';

const BASE = 'https://www.googleapis.com/youtube/v3/';

export function personalKey() { return String(state.settings.ytApiKey || '').trim(); }
export function apiKey() { return personalKey() || YOUTUBE_API_KEY || ''; }
export function hasApiKey() { return !!apiKey(); }
export function usingAppKey() { return !personalKey() && !!YOUTUBE_API_KEY; }

export class YTApiError extends Error {
  constructor(message, reason = '', status = 0) { super(message); this.reason = reason; this.status = status; }
}

const MESSAGES = {
  quotaExceeded: '今日の取得上限に達しました（日本時間の17時ごろ、夏時間は16時ごろにリセット）。それまでは概要欄をコピーして貼り付けてください',
  dailyLimitExceeded: '今日の取得上限に達しました。概要欄をコピーして貼り付けてください',
  rateLimitExceeded: '短時間に問い合わせが集中しました。少し待ってからもう一度お試しください',
  keyInvalid: 'APIキーが正しくありません（設定を確認してください）',
  badRequest: 'APIキーが正しくありません（設定を確認してください）',
  forbidden: 'このサイトからは、このAPIキーを使えない設定になっています（キーの「ウェブサイトの制限」を確認してください）',
  ipRefererBlocked: 'このサイトからは、このAPIキーを使えない設定になっています（キーの「ウェブサイトの制限」を確認してください）',
  accessNotConfigured: 'このAPIキーのプロジェクトで YouTube Data API v3 が有効になっていません',
  keyExpired: 'APIキーの有効期限が切れています。新しいキーを作成してください'
};

async function call(path, params) {
  const key = apiKey();
  if (!key) throw new YTApiError('YouTube Data API のキーが設定されていません', 'noKey');
  let res;
  try {
    res = await fetch(`${BASE}${path}?${new URLSearchParams({ ...params, key })}`);
  } catch {
    throw new YTApiError('YouTube に接続できませんでした（ネットワークを確認してください）', 'network');
  }
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const err = data && data.error;
    const reason = (err && err.errors && err.errors[0] && err.errors[0].reason) || (err && err.status) || '';
    const msg = MESSAGES[reason] || (err && /API key not valid/i.test(err.message || '') ? MESSAGES.keyInvalid : '') || `YouTube Data API のエラー（${res.status}${reason ? ' ' + reason : ''}）`;
    throw new YTApiError(msg, reason, res.status);
  }
  return data;
}

// 動画の情報: { title, channel, description, duration }
export async function fetchVideoMeta(videoId) {
  const data = await call('videos', { part: 'snippet,contentDetails', id: videoId, fields: 'items(snippet(title,channelTitle,description),contentDetails(duration))' });
  const item = data && data.items && data.items[0];
  if (!item) throw new YTApiError('動画が見つかりません（非公開または削除された可能性があります）', 'notFound', 404);
  const duration = parseIsoDuration(item.contentDetails && item.contentDetails.duration);
  if (duration > 0) store.rememberDuration(videoId, duration);
  return { title: item.snippet.title || '', channel: item.snippet.channelTitle || '', description: item.snippet.description || '', duration };
}

// 上位のコメント（コメントが無効な動画は空配列）
export async function fetchTopComments(videoId, max = 100) {
  try {
    const data = await call('commentThreads', {
      part: 'snippet', videoId, maxResults: String(max), order: 'relevance', textFormat: 'plainText',
      fields: 'items(snippet(topLevelComment(snippet(textDisplay,authorDisplayName,likeCount))))'
    });
    return (data.items || []).map(it => {
      const s = it.snippet.topLevelComment.snippet;
      return { text: s.textDisplay || '', author: s.authorDisplayName || '', likes: s.likeCount || 0 };
    });
  } catch (e) {
    if (e.reason === 'commentsDisabled' || e.status === 404) return [];
    throw e;
  }
}

const session = new Map(); // videoId → 結果（このタブを開いている間だけ）

// 概要欄とコメントからセトリ候補を探す。概要欄で十分な候補が見つかればコメントは読まない
export async function discoverSetlists(videoId) {
  if (session.has(videoId)) return session.get(videoId);
  const meta = await fetchVideoMeta(videoId);
  let candidates = findSetlists({ description: meta.description, duration: meta.duration });
  let checkedComments = false;
  if (!candidates.length || candidates[0].items.length < 5) {
    const comments = await fetchTopComments(videoId);
    checkedComments = true;
    candidates = findSetlists({ description: meta.description, comments, duration: meta.duration });
  }
  const result = { meta: { title: meta.title, channel: meta.channel, duration: meta.duration }, candidates, checkedComments };
  session.set(videoId, result);
  return result;
}
