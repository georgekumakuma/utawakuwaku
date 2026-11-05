// 原曲の長さから曲の終わりを推定する（曲間のトーク・無音をカットするため）
//
// 埋め込みプレイヤーの音声は読み取れないので、無音検知の代わりに
// 「開始 + 原曲の長さ + 余韻」を終わりとみなす。
// 推定はいつも「短くする」方向だけ: 次の曲の開始を越えて延ばしたり、
// 原曲より明らかに短い区間（TVサイズ・メドレーなど）を切ったりはしない。

import { normalizeTitle } from './insights.js';

const VERSION_RE = /(tv\s*(size|ver|edit)|tvサイズ|instrumental|inst\b|inst\.|off\s*vocal|karaoke|カラオケ|short\s*ver|ショート|remix|acoustic|アコースティック|live\b|ライブ|piano\s*ver|orchestra|オーケストラ|music\s*box|オルゴール)/i;

function norm(s) {
  return String(s || '').normalize('NFKC').toLowerCase().replace(/[\s　・･\-–—_~〜～!?！？。、,.'"“”‘’「」『』:;／/♪☆★()（）\[\]【】]+/g, '');
}

// iTunes Search API の結果から、曲に最も合う1件を選ぶ
// 戻り値: { seconds, trackName, artistName, score } または null
export function pickTrack(results, { title, artist = '' }) {
  const wantTitle = normalizeTitle(title);
  if (!wantTitle) return null;
  const wantArtist = norm(artist);
  const titleHasVersion = VERSION_RE.test(title);
  let best = null;
  for (const r of results || []) {
    if (!r || !r.trackName || !(r.trackTimeMillis > 0)) continue;
    if (r.kind && r.kind !== 'song') continue;
    const t = normalizeTitle(r.trackName);
    let score = 0;
    if (t === wantTitle) score = 3;
    else if (t && (t.includes(wantTitle) || wantTitle.includes(t)) && Math.min(t.length, wantTitle.length) >= 2) score = 1.5;
    else continue;
    const versionText = `${r.trackName} ${r.collectionName || ''}`;
    if (!titleHasVersion && VERSION_RE.test(versionText)) score -= 2;
    if (wantArtist) {
      const a = norm(r.artistName);
      if (a && (a.includes(wantArtist) || wantArtist.includes(a))) score += 2;
      else score -= 0.5;
    }
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = { seconds: Math.round(r.trackTimeMillis / 1000), trackName: r.trackName, artistName: r.artistName || '', score };
    }
  }
  return best;
}

// 終わりの推定
// start / end: いまの区間（end が 0 なら「最後まで」= 不明）
// duration: 原曲の長さ（秒）, tail: 余韻（秒）
// 戻り値: { end, cut }（cut は短くなる秒数。end が不明だった場合は null）または null（変更しない）
export function estimateEnd({ start, end = 0, duration, tail = 5, minSong = 45 }) {
  if (!(duration >= minSong)) return null;
  const target = Math.round(start + duration + tail);
  if (end > start) {
    const len = end - start;
    if (len < duration * 0.85) return null;      // 原曲より短い区間 → TVサイズ等の可能性。触らない
    if (target >= end - 2) return null;          // ほぼ曲間がない → そのまま
    return { end: target, cut: end - target };
  }
  return { end: target, cut: null };
}

// 検索語: 曲名（注記を除く）＋アーティスト
export function searchTerm({ title, artist = '' }) {
  const t = String(title || '').replace(/[(\[（【［][^)\]）】］]*[)\]）】］]/g, ' ').replace(/\s+/g, ' ').trim() || String(title || '').trim();
  return [t, String(artist || '').trim()].filter(Boolean).join(' ');
}

export function cacheKey({ title, artist = '' }) {
  return `${normalizeTitle(title)}|${norm(artist)}`;
}
