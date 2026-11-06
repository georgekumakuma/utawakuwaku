// YouTube の URL / 動画ID の解析

const ID_RE = /^[\w-]{11}$/;
const URL_RE = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|v\/|shorts\/|live\/))([\w-]{11})/;

// "1h2m3s" / "123" / "1:02:03" → 秒
function parseTParam(t) {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (m) return (parseInt(m[1] || 0, 10) * 3600) + (parseInt(m[2] || 0, 10) * 60) + parseInt(m[3] || 0, 10);
  const parts = t.split(':').map(Number);
  if (parts.every(n => !isNaN(n))) return parts.reduce((a, b) => a * 60 + b, 0);
  return 0;
}

// 入力文字列から { videoId, start } を取り出す。見つからなければ null
export function parseYouTubeInput(input) {
  if (!input) return null;
  const str = String(input).trim();
  if (ID_RE.test(str)) return { videoId: str, start: 0 };
  const m = str.match(URL_RE);
  if (!m) return null;
  let start = 0;
  const tm = str.match(/[?&#](?:t|start)=([^&#\s]+)/);
  if (tm) start = parseTParam(decodeURIComponent(tm[1]));
  return { videoId: m[1], start };
}

export function extractVideoId(input) {
  const r = parseYouTubeInput(input);
  return r ? r.videoId : null;
}

export function isValidVideoId(id) {
  return ID_RE.test(id || '');
}

export function watchUrl(videoId, start = 0) {
  const t = Math.floor(start || 0);
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}${t > 0 ? `&t=${t}s` : ''}`;
}

export function thumbUrl(videoId, size = 'mqdefault') {
  // default(120x90) / mqdefault(320x180) / hqdefault(480x360) / sddefault(640x480) / maxresdefault
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${size}.jpg`;
}
