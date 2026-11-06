// アートワーク連動の色: 再生中の曲のサムネイルから色を読み取り、UI のアクセントと背景の光に反映する。
// サムネイル画像の画素を読めない環境（CORS 非対応など）では、テーマのアクセントカラーのまま動く。

import { state } from '../core/store.js';
import * as store from '../core/store.js';
import { ctx } from '../app/context.js';
import { thumbUrl } from '../core/ytid.js';
import { pickPalette, accentFromColor } from '../core/color.js';
import { applyTheme, ACCENTS, currentTheme } from './theme.js';

const cache = new Map(); // videoId → Promise<string[]|null>

export function extractPalette(videoId) {
  if (cache.has(videoId)) return cache.get(videoId);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const timer = setTimeout(() => resolve(null), 5000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const w = 48, h = 27;
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, w, h);
        resolve(pickPalette(g.getImageData(0, 0, w, h).data));
      } catch {
        resolve(null); // tainted canvas
      }
    };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = thumbUrl(videoId, 'mqdefault');
  });
  cache.set(videoId, p);
  return p;
}

let currentVideo = null;
let palette = null;

function setAmbientVars(colors) {
  const root = document.documentElement.style;
  colors.forEach((c, i) => root.setProperty(`--amb-${i + 1}`, c));
}

function themeColors() {
  const a = ACCENTS[state.settings.accent] || ACCENTS.aurora;
  return [a.from, a.to, a.from];
}

function apply() {
  applyTheme();
  const useArt = state.settings.artworkColor && palette;
  if (!useArt) {
    setAmbientVars(palette || themeColors());
    document.documentElement.dataset.artwork = 'off';
    return;
  }
  const theme = currentTheme();
  const { accent, accent2, hue } = accentFromColor(palette[0], theme);
  const root = document.documentElement.style;
  root.setProperty('--accent', accent);
  root.setProperty('--accent-2', accent2);
  root.setProperty('--accent-h', String(hue));
  setAmbientVars(palette);
  document.documentElement.dataset.artwork = 'on';
}

// テーマ・アクセント・アートワーク色をまとめて反映し直す
export function refreshColors() { apply(); }

export function getPalette() { return palette || themeColors(); }

async function onSong(song) {
  if (!song || !song.videoId) return;
  if (song.videoId === currentVideo) return;
  currentVideo = song.videoId;
  const vid = song.videoId;
  const p = await extractPalette(vid);
  if (vid !== currentVideo) return;
  palette = p;
  apply();
  document.dispatchEvent(new CustomEvent('uta:palette', { detail: getPalette() }));
}

export function mountAmbient() {
  setAmbientVars(themeColors());
  if (ctx.engine) ctx.engine.on('change', () => onSong(ctx.engine.state.song));
  store.on('settings', () => apply());
}
