// 貼り付け・ドロップされたテキストが何かを判定する

import { parseYouTubeInput } from './ytid.js';
import { parseSetlist } from './setlist.js';
import { normalizeBankUrl } from './sharedbank.js';
import { shareHashOf } from './share.js';

const YT_URL_RE = /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\/[^\s<>"']+/i;

// タブ区切り（スプレッドシートからのコピー）→ CSV
export function tsvToCsv(text) {
  const esc = (v) => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  return String(text).split(/\r?\n/).map(line => line.split('\t').map(esc).join(',')).join('\n');
}

// 戻り値: { kind: 'csv'|'setlist'|'url'|'bank'|'share', url?, text?, hash? } または null
export function classifyText(raw) {
  const text = String(raw || '').replace(/^﻿/, '').trim();
  if (!text) return null;
  if (!text.includes('\n')) {
    const hash = shareHashOf(text);
    if (hash) return { kind: 'share', hash };
  }
  const firstLine = text.split(/\r?\n/, 1)[0];
  if (/^videoid[\t,]/i.test(firstLine)) {
    return { kind: 'csv', text: firstLine.includes('\t') ? tsvToCsv(text) : text };
  }
  const m = text.match(YT_URL_RE);
  const yt = m ? parseYouTubeInput(m[0]) : null;
  if (parseSetlist(text).length >= 2) {
    return { kind: 'setlist', url: yt ? m[0] : '', text };
  }
  if (!text.includes('\n')) {
    const single = parseYouTubeInput(text);
    if (single) return { kind: 'url', url: text };
    if (/^https?:\/\//i.test(text)) {
      const n = normalizeBankUrl(text);
      if (n && (n.kind.startsWith('gsheet') || /\.(csv|json)(\?|#|$)/i.test(text) || n.kind === 'gist' || n.kind === 'github')) return { kind: 'bank', url: text };
    }
  }
  if (yt) return { kind: 'url', url: m[0] };
  return null;
}
