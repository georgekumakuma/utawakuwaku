// 時刻の解析・整形（秒 ⇔ "h:mm:ss" / "m:ss"）
// 小数秒（0.1秒単位）も扱える。CSV互換のため整数秒は整数のまま出力する。

const TIME_RE = /^(?:(\d{1,3}):)?(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?$/;

// "1:23:45" / "3:05" / "90" / "90.5" / "1h2m3s" / "" → 秒（不正なら NaN）
export function parseTime(input) {
  if (input == null) return NaN;
  if (typeof input === 'number') return isFinite(input) ? input : NaN;
  const str = String(input).trim();
  if (!str) return NaN;

  let m = str.match(TIME_RE);
  if (m) {
    const h = m[1] ? parseInt(m[1], 10) : 0;
    const mm = parseInt(m[2], 10);
    const s = parseInt(m[3], 10);
    const frac = m[4] ? parseFloat('0.' + m[4]) : 0;
    return h * 3600 + mm * 60 + s + frac;
  }
  m = str.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+(?:\.\d+)?)s?)?$/i);
  if (m && (m[1] || m[2] || m[3])) {
    return (parseInt(m[1] || 0, 10) * 3600) + (parseInt(m[2] || 0, 10) * 60) + parseFloat(m[3] || 0);
  }
  if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
  return NaN;
}

// 秒 → "h:mm:ss" または "m:ss"。 frac=true で 0.1 秒を付ける
export function formatTime(sec, { frac = false } = {}) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const whole = Math.floor(sec);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  let out = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
  if (frac) out += '.' + Math.floor((sec - whole) * 10);
  return out;
}

// 曲の長さ表示用（"3分12秒" のような人間向け）
export function formatDurationHuman(sec) {
  if (!isFinite(sec) || sec <= 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}時間${m}分`;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

// 0.1秒単位に丸める（浮動小数の誤差を除去）
export function roundTenth(sec) {
  return Math.round(sec * 10) / 10;
}

// 数値を CSV 用に整形（整数なら整数、それ以外は小数1桁）
export function secToCSV(sec) {
  const v = roundTenth(Number(sec) || 0);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// 相対的な日時表示（"3分前" など）
export function formatRelative(ts, now = Date.now()) {
  if (!ts) return '';
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}日前`;
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
