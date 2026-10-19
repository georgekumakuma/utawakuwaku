// テーマ・アクセントカラー

import { state } from '../core/store.js';

export const ACCENTS = {
  aurora: { label: 'オーロラ', from: '#7c5cff', to: '#2ed3c6', h: 258 },
  sakura: { label: '桜', from: '#ff5c8a', to: '#ffb86b', h: 340 },
  ocean: { label: '海', from: '#2f80ed', to: '#56ccf2', h: 212 },
  lime: { label: '若葉', from: '#3ddc84', to: '#b4ec51', h: 150 },
  sunset: { label: '夕焼け', from: '#ff6b3d', to: '#ffd166', h: 18 },
  mono: { label: 'モノクローム', from: '#e5e7eb', to: '#9ca3af', h: 220 }
};

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;

export function applyTheme() {
  const root = document.documentElement;
  let theme = state.settings.theme;
  if (theme === 'auto') theme = mq && mq.matches ? 'light' : 'dark';
  root.dataset.theme = theme;
  const a = ACCENTS[state.settings.accent] || ACCENTS.aurora;
  root.style.setProperty('--accent', a.from);
  root.style.setProperty('--accent-2', a.to);
  root.style.setProperty('--accent-h', String(a.h));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#f5f6fa' : '#0e0f14';
}

export function watchSystemTheme() {
  if (mq) mq.addEventListener('change', () => { if (state.settings.theme === 'auto') applyTheme(); });
}
