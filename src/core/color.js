// 色の計算: サムネイル画像の画素から代表色を選び、読みやすいアクセントカラーに整える

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

export function toHex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex) {
  const m = String(hex).replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

// WCAG の相対輝度とコントラスト比
export function luminance([r, g, b]) {
  const c = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// RGBA の画素列から、鮮やかで互いに色相の離れた代表色を最大 count 個選ぶ。
// 鮮やかな画素がほとんど無い（モノクロ等）場合は null
export function pickPalette(data, { count = 3, minHueGap = 28 } = {}) {
  const BUCKETS = 36;
  const acc = Array.from({ length: BUCKETS }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let vividWeight = 0, total = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const [h, s, l] = rgbToHsl(r, g, b);
    total++;
    if (s < 0.22 || l < 0.12 || l > 0.9) continue;
    const w = s * s * (1 - Math.abs(l - 0.5) * 1.4);
    if (w <= 0) continue;
    const bucket = acc[Math.floor(h / 360 * BUCKETS) % BUCKETS];
    bucket.w += w; bucket.r += r * w; bucket.g += g * w; bucket.b += b * w;
    vividWeight += w;
  }
  if (!total || vividWeight / total < 0.02) return null;
  const ranked = acc.map(b => b.w ? { w: b.w, rgb: [b.r / b.w, b.g / b.w, b.b / b.w] } : null)
    .filter(Boolean).sort((a, b) => b.w - a.w);
  const out = [];
  for (const c of ranked) {
    const h = rgbToHsl(...c.rgb)[0];
    if (out.every(o => hueDist(o.h, h) >= minHueGap)) out.push({ h, rgb: c.rgb.map(Math.round), weight: c.w / vividWeight });
    if (out.length >= count) break;
  }
  // 足りない分は主色から色相をずらして補う
  const base = out[0];
  let k = 1;
  while (out.length < count) {
    const [h, s, l] = rgbToHsl(...base.rgb);
    const nh = (h + 40 * k * (k % 2 ? 1 : -1) + 360) % 360;
    out.push({ h: nh, rgb: hslToRgb(nh, s, l), weight: 0 });
    k++;
  }
  return out.map(o => toHex(o.rgb));
}

// 背景色に対して contrast 比 target 以上になるまで明度を動かす
export function ensureContrast(h, s, l, bgRgb, target = 4.5) {
  const bgLight = luminance(bgRgb) > 0.4;
  let cur = l;
  for (let i = 0; i < 60; i++) {
    const rgb = hslToRgb(h, s, cur);
    if (contrast(rgb, bgRgb) >= target) return rgb;
    cur = bgLight ? cur - 0.015 : cur + 0.015;
    if (cur <= 0.05 || cur >= 0.95) break;
  }
  return hslToRgb(h, s, Math.max(0.05, Math.min(0.95, cur)));
}

// 代表色 → UI 用のアクセント2色（読みやすさを保証）
export function accentFromColor(hex, theme = 'dark') {
  const [h, s0] = rgbToHsl(...fromHex(hex));
  const s = Math.max(0.55, Math.min(0.9, s0));
  const bg = theme === 'light' ? [244, 245, 249] : [14, 15, 20];
  const a1 = ensureContrast(h, s, theme === 'light' ? 0.45 : 0.62, bg, 4.5);
  const h2 = (h + 35) % 360;
  const a2 = ensureContrast(h2, Math.min(0.85, s + 0.05), theme === 'light' ? 0.42 : 0.6, bg, 3);
  return { accent: toHex(a1), accent2: toHex(a2), hue: Math.round(h) };
}
