// トースト通知（複数スタック・アクションボタン付き）

import { h, icon } from './dom.js';

let host = null;
const MAX = 4;

function ensureHost() {
  if (!host) {
    host = h('div.toast-host', { role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  return host;
}

export function toast(message, { duration = 3200, action = null, kind = 'info' } = {}) {
  const root = ensureHost();
  while (root.children.length >= MAX) root.firstChild.remove();
  let timer = null;
  const el = h('div.toast', { class: `toast-${kind}` },
    h('span.toast-msg', message),
    action ? h('button.toast-action', {
      type: 'button',
      onclick: () => { try { action.callback(); } finally { dismiss(); } }
    }, action.text) : null,
    h('button.toast-close', { type: 'button', 'aria-label': '閉じる', onclick: () => dismiss() }, icon('close'))
  );
  function dismiss() {
    clearTimeout(timer);
    el.classList.add('hide');
    setTimeout(() => el.remove(), 220);
  }
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  if (duration > 0) timer = setTimeout(dismiss, duration);
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { if (duration > 0) timer = setTimeout(dismiss, 1500); });
  return { dismiss, el, setMessage: (m) => { el.querySelector(".toast-msg").textContent = m; } };
}

export const toastError = (msg, opts = {}) => toast(msg, { kind: 'error', duration: 6000, ...opts });
export const toastSuccess = (msg, opts = {}) => toast(msg, { kind: 'success', ...opts });
