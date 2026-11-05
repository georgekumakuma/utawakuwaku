// 小さな DOM ユーティリティ

// h('div.cls#id', {attrs}, ...children)
export function h(tag, attrs, ...children) {
  if (attrs && (attrs instanceof Node || typeof attrs !== 'object' || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') { if (v) el.className += (el.className ? ' ' : '') + v; }
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    parent.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return parent;
}

// replaceChildren と同じだが、null / false を飛ばす（h() と同じ扱い）。
// ネイティブの replaceChildren(null) は文字列 "null" を挿入してしまう
export function fill(el, ...children) {
  el.replaceChildren(...children.flat().filter(c => c != null && c !== false));
  return el;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// イベント委譲
export function delegate(root, evt, selector, fn, opts) {
  root.addEventListener(evt, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) fn(e, target);
  }, opts);
}

// 検索語のハイライト（textContent を安全に分割）
export function highlightInto(el, text, query) {
  clear(el);
  const q = (query || '').trim();
  if (!q) { el.textContent = text; return; }
  const lower = text.toLowerCase();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const marks = [];
  for (const t of terms) {
    let i = 0;
    while ((i = lower.indexOf(t, i)) >= 0) { marks.push([i, i + t.length]); i += t.length; }
  }
  marks.sort((a, b) => a[0] - b[0]);
  let pos = 0;
  for (const [s, e] of marks) {
    if (s < pos) continue;
    if (s > pos) el.appendChild(document.createTextNode(text.slice(pos, s)));
    el.appendChild(h('mark', text.slice(s, e)));
    pos = e;
  }
  if (pos < text.length) el.appendChild(document.createTextNode(text.slice(pos)));
}

export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function rafThrottle(fn) {
  let pending = false;
  let lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; fn(...lastArgs); });
  };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 }, value: text });
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function downloadText(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
}

export function datestamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

// アイコン（インライン SVG）
const ICONS = {
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
  stop: '<path d="M6 6h12v12H6z"/>',
  next: '<path d="M6 6l8.5 6L6 18zM16 6h2v12h-2z"/>',
  prev: '<path d="M18 6l-8.5 6L18 18zM6 6h2v12H6z"/>',
  shuffle: '<path d="M10.6 9.2 7.4 5.4A2 2 0 0 0 5.9 4.7H3v2h2.9l2.6 3.1 1.3-1.6zm4.9-3.2 1.8 1.8L13 12l4.3 4.2-1.8 1.8L17.6 16H15a2 2 0 0 1-1.5-.7L10.4 11.6l1.3-1.6 3.1 3.7h2.8l-2.1-2.1 1.8-1.8-1.8-1.8L17.6 6H15a2 2 0 0 0-1.5.7l-6.2 7.4A2 2 0 0 1 5.9 15H3v2h2.9a2 2 0 0 0 1.5-.7L13.6 9h4l-2.1 2.1 1.8 1.8L21 9.2 17.3 5.5l-1.8 1.8-.1-1.3z"/>',
  repeat: '<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>',
  repeatOne: '<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/>',
  volume: '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/>',
  mute: '<path d="M16.5 12A4.5 4.5 0 0 0 14 8v2.2l2.5 2.5c0-.2 0-.5 0-.7zm2.5 0c0 .9-.2 1.8-.5 2.6l1.5 1.5A9 9 0 0 0 14 3.2v2.1A7 7 0 0 1 19 12zM4.3 3 3 4.3 7.7 9H3v6h4l5 5v-6.7l4.3 4.3a7 7 0 0 1-2.3 1.2v2.1a9 9 0 0 0 3.7-1.8L19.7 21 21 19.7 4.3 3zM12 4 9.9 6.1 12 8.2V4z"/>',
  plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/>',
  search: '<path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/>',
  edit: '<path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
  trash: '<path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>',
  more: '<path d="M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>',
  menu: '<path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/>',
  close: '<path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4l5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6z"/>',
  list: '<path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>',
  queue: '<path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.2a3 3 0 1 0 2 2.8V8h3V6h-5z"/>',
  history: '<path d="M13 3a9 9 0 0 0-9 9H1l3.9 3.9L9 12H6a7 7 0 1 1 2 4.9l-1.4 1.4A9 9 0 1 0 13 3zm-1 5v5l4.3 2.5.7-1.2-3.5-2.1V8H12z"/>',
  library: '<path d="M4 6H2v14a2 2 0 0 0 2 2h14v-2H4V6zm16-4H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-8 12.5v-9l6 4.5-6 4.5z"/>',
  bank: '<path d="M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm0 12H4V8h16v10z"/>',
  settings: '<path d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.3 7.3 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4l-.4 2.6c-.6.3-1.2.6-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.7 1.7 1l.4 2.6c0 .2.2.4.5.4h4c.2 0 .5-.2.5-.4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6L19.4 13zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>',
  share: '<path d="M18 16a3 3 0 0 0-2 .8l-7.1-4.1a3.3 3.3 0 0 0 0-1.4L15.9 7a3 3 0 1 0-1-2.2c0 .2 0 .5.1.7L8 9.6a3 3 0 1 0 0 4.8l7.1 4.2a3 3 0 1 0 2.9-2.6z"/>',
  download: '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>',
  upload: '<path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/>',
  link: '<path d="M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 0 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12zM8 13h8v-2H8v2zm9-6h-4v1.9h4a3.1 3.1 0 0 1 0 6.2h-4V17h4a5 5 0 0 0 0-10z"/>',
  check: '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>',
  video: '<path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>',
  keyboard: '<path d="M20 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z"/>',
  sparkle: '<path d="m12 2 2.1 5.9L20 10l-5.9 2.1L12 18l-2.1-5.9L4 10l5.9-2.1L12 2zm7 12 1 2.8 2.8 1-2.8 1L19 22l-1-3.2-2.8-1 2.8-1 1-2.8zM5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14z"/>',
  grip: '<path d="M9 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9 16a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/>',
  clock: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z"/>',
  star: '<path d="m12 17.3 6.2 3.7-1.6-7 5.4-4.7-7.2-.6L12 2 9.2 8.7 2 9.3l5.4 4.7-1.6 7z"/>',
  external: '<path d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3h-7z"/>',
  flag: '<path d="M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z"/>',
  chevronDown: '<path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/>',
  chevronLeft: '<path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/>',
  chevronRight: '<path d="M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"/>',
  moon: '<path d="M12 3a9 9 0 1 0 9 9c0-.5 0-.9-.1-1.3A5.5 5.5 0 0 1 13.3 3.1 9 9 0 0 0 12 3z"/>',
  sun: '<path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5h0v3h0zm0 17v3zM2 12h3zm17 0h3zM4.9 4.9l2.1 2.1zm12.1 12.1 2.1 2.1zM4.9 19.1 7 17zm12.1-12.1L19.1 4.9z" stroke="currentColor" stroke-width="2"/>',
  magic: '<path d="M7.5 5.6 10 7 8.6 4.5 10 2 7.5 3.4 5 2l1.4 2.5L5 7zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5zm-7.6 7.3a1 1 0 0 0-1.4 0L2.3 20a1 1 0 0 0 0 1.4l.3.3a1 1 0 0 0 1.4 0L14.7 11a1 1 0 0 0 0-1.4l-.3-.3zm-1 2.4-1.3-1.3.9-.9 1.3 1.3-.9.9z"/>',
  info: '<path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16z"/>',
  tag: '<path d="m21.4 11.6-9-9A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 .6 1.4l9 9a2 2 0 0 0 2.8 0l7-7a2 2 0 0 0 0-2.8zM5.5 7A1.5 1.5 0 1 1 7 5.5 1.5 1.5 0 0 1 5.5 7z"/>',
  scissors: '<path d="M9.6 7.6A3 3 0 1 0 8 9.9l1.4 1.4-2 2A3 3 0 1 0 9 15l2-2 8 8h3L9.6 7.6zM6 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm0 10a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm7-5.5-1.5-1.5L19 3h3L13 12.5z"/>',
  layers: '<path d="m12 16-7-5.4L3.5 12 12 18.6l8.5-6.6L19 10.6 12 16zm0-2.5 7-5.5-7-5.5L5 8l7 5.5z"/>',
  text: '<path d="M5 4v3h5.5v12h3V7H19V4z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/>',
  game: '<path d="M21 6H3a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4-3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/>',
  radio: '<path d="M3.24 6.15A2 2 0 0 0 2 8v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H8.3l8.26-3.34L15.88 1 3.24 6.15zM7 20a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm13-8h-2v-2h-2v2H4V8h16v4z"/>',
  timeline: '<path d="M3 5h8v4H3zm10 0h8v4h-8zM3 11h5v4H3zm7 0h11v4H10zM3 17h12v4H3zm14 0h4v4h-4z"/>',
  theater: '<path d="M21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5v2h8v-2h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 14H3V5h18v12zM10 8v6l5-3z"/>'
};

export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `ic ${cls}`.trim());
  svg.innerHTML = ICONS[name] || ICONS.info;
  return svg;
}

export function stars(rating, { max = 6, interactive = false, onChange } = {}) {
  const wrap = h('span.stars', { role: interactive ? 'radiogroup' : undefined, 'aria-label': `評価 ${rating}` });
  for (let i = 1; i <= max; i++) {
    const s = h('span.star', { class: i <= rating ? 'on' : '', dataset: { v: String(i) }, text: i <= rating ? '★' : '☆' });
    if (interactive) {
      s.tabIndex = 0;
      s.addEventListener('click', (e) => { e.stopPropagation(); onChange && onChange(i); });
      s.addEventListener('mouseenter', () => wrap.querySelectorAll('.star').forEach((x, j) => x.classList.toggle('hover', j < i)));
      s.addEventListener('mouseleave', () => wrap.querySelectorAll('.star').forEach(x => x.classList.remove('hover')));
    }
    wrap.appendChild(s);
  }
  return wrap;
}

export function setStars(wrap, rating) {
  wrap.querySelectorAll('.star').forEach((s, i) => {
    s.classList.toggle('on', i < rating);
    s.textContent = i < rating ? '★' : '☆';
  });
  wrap.setAttribute('aria-label', `評価 ${rating}`);
}

// 文字が1つずつ浮かび上がるタイトル表示（同じ文字列なら何もしない）
export function animateText(el, text, { stagger = 22, max = 48 } = {}) {
  if (el.dataset.text === text) return;
  el.dataset.text = text;
  el.setAttribute('aria-label', text);
  if (text.length > max) {
    el.replaceChildren(h('span.ch-fade', text));
    return;
  }
  el.replaceChildren(...Array.from(text).map((ch, i) =>
    h('span.ch', { 'aria-hidden': 'true', style: { animationDelay: `${i * stagger}ms` } }, ch === ' ' ? ' ' : ch)));
}
