// テスト用: i.ytimg.com のサムネイルの代わりに、動画IDごとに色の違う PNG を返す
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}

export function thumbPng(videoId, w = 320, h = 180) {
  let seed = 0;
  for (const ch of videoId) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const h1 = seed % 360, h2 = (h1 + 70 + (seed >> 8) % 90) % 360;
  const c1 = hsl(h1, 0.75, 0.5), c2 = hsl(h2, 0.7, 0.45), dark = [16, 14, 24];
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      const d1 = Math.hypot(x - w * 0.3, y - h * 0.45) / (w * 0.35);
      const d2 = Math.hypot(x - w * 0.75, y - h * 0.6) / (w * 0.3);
      let c = dark.map((v, i) => v + (c1[i] - v) * Math.max(0, 1 - d1) + (c2[i] - v) * Math.max(0, 1 - d2) * 0.9);
      c = c.map((v, i) => v * (0.85 + 0.15 * t));
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = Math.min(255, c[0]); raw[o + 1] = Math.min(255, c[1]); raw[o + 2] = Math.min(255, c[2]);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Playwright の page / context に、サムネイルの偽装ルートを設定する
export async function routeThumbs(target) {
  const cache = new Map();
  await target.route('https://i.ytimg.com/**', (route) => {
    const m = route.request().url().match(/\/vi\/([^/]+)\//);
    const id = m ? decodeURIComponent(m[1]) : 'x';
    if (!cache.has(id)) cache.set(id, thumbPng(id));
    route.fulfill({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: cache.get(id) });
  });
}
