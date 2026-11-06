// 動画の概要欄・コメントからセットリストの候補を見つける

import { parseSetlist } from './setlist.js';

// ISO 8601 の長さ（"PT1H2M3S"）→ 秒
export function parseIsoDuration(iso) {
  const m = String(iso || '').match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return 0;
  return (parseInt(m[1] || 0, 10) * 86400) + (parseInt(m[2] || 0, 10) * 3600) + (parseInt(m[3] || 0, 10) * 60) + Math.round(parseFloat(m[4] || 0));
}

// 曲ではなさそうなチャプター（待機画面・オープニング・トーク等）
const NON_SONG_RE = /^(待機|待機画面|オープニング|opening|op|start|スタート|開始|はじまり|始まり|雑談|トーク|talk|mc|フリートーク|休憩|エンディング|ending|ed|おわり|終わり|締め|しめ|お知らせ|告知|スパチャ|スーパーチャット|super\s*chat|superchat|スパチャ読み|感謝|あいさつ|挨拶|乾杯|自己紹介|告知タイム|アンケート|配信開始|配信終了|endcard|エンドカード)(\s|$|[!！。・:：)）〜~-])/i;
export function isLikelyNonSong(title) {
  const t = String(title || '').normalize('NFKC').trim().replace(/^[\s\-・]+/, '');
  return !t || NON_SONG_RE.test(t) || /^(待機|雑談|トーク|休憩|スパチャ|お知らせ)$/.test(t);
}

function signature(items) {
  return items.map(it => it.start).join(',');
}

// 候補: [{ source: 'description'|'comment', label, author, likes, text, items }]
// minItems 曲以上のタイムスタンプを含むものだけ。説明欄 → コメント（曲数・いいねの多い順）
export function findSetlists({ description = '', comments = [], duration = 0 }, { minItems = 3, max = 4 } = {}) {
  const out = [];
  const seen = new Set();
  const add = (cand) => {
    if (cand.items.length < minItems) return;
    const starts = new Set(cand.items.map(it => it.start));
    if (starts.size < minItems) return;
    const sig = signature(cand.items);
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push(cand);
  };
  if (description) {
    add({ source: 'description', label: '概要欄', author: '', likes: 0, text: description, items: parseSetlist(description, { duration }) });
  }
  const fromComments = comments.map(c => ({
    source: 'comment', label: 'コメント', author: c.author || '', likes: c.likes || 0, text: c.text || '',
    items: parseSetlist(c.text || '', { duration })
  })).sort((a, b) => b.items.length - a.items.length || b.likes - a.likes);
  fromComments.forEach(add);
  return out.slice(0, max);
}

// 候補の中の「曲」の数（曲ではなさそうなものを除く）
export function songCount(items) {
  return items.filter(it => !isLikelyNonSong(it.title)).length;
}
