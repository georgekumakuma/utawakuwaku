// モーダルダイアログ（confirm / prompt / 任意コンテンツ）
// window.confirm / prompt は見た目が悪く、Electron や PWA でブロックされることもあるので自前で持つ。

import { h, icon } from './dom.js';

const stack = [];

export function openModal({ title, content, actions = [], size = 'md', onClose, dismissable = true, className = '' }) {
  const overlay = h('div.modal-overlay', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || '' });
  const box = h('div.modal', { class: `modal-${size} ${className}` });
  const header = h('div.modal-header',
    h('h2.modal-title', title || ''),
    dismissable ? h('button.icon-btn', { type: 'button', 'aria-label': '閉じる', onclick: () => close() }, icon('close')) : null
  );
  const body = h('div.modal-body');
  if (typeof content === 'string') body.innerHTML = content;
  else if (content) body.appendChild(content);
  const footer = h('div.modal-footer');
  for (const a of actions) {
    const btn = h('button.btn', { type: 'button', class: a.primary ? 'btn-primary' : (a.danger ? 'btn-danger' : 'btn-ghost') }, a.label);
    btn.addEventListener('click', async () => {
      if (a.onClick) {
        const r = await a.onClick(api);
        if (r === false) return;
      }
      if (a.keepOpen !== true) close(a.value);
    });
    footer.appendChild(btn);
    if (a.autofocus) setTimeout(() => btn.focus(), 30);
  }
  box.append(header, body);
  if (actions.length) box.appendChild(footer);
  overlay.appendChild(box);

  let closed = false;
  let resolveFn = null;
  const done = new Promise(r => { resolveFn = r; });

  function close(value) {
    if (closed) return;
    closed = true;
    overlay.classList.add('hide');
    setTimeout(() => overlay.remove(), 180);
    const i = stack.indexOf(api);
    if (i >= 0) stack.splice(i, 1);
    if (onClose) onClose(value);
    resolveFn(value);
    if (!stack.length) document.body.classList.remove('modal-open');
  }

  overlay.addEventListener('mousedown', (e) => {
    if (dismissable && e.target === overlay) close(undefined);
  });

  const api = { close, overlay, box, body, done, setTitle: (t) => { header.firstChild.textContent = t; } };
  stack.push(api);
  document.body.classList.add('modal-open');
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));
  const focusable = box.querySelector('input, textarea, select, button.btn-primary, button');
  if (focusable) setTimeout(() => focusable.focus(), 40);
  return api;
}

export function closeTopModal() {
  const top = stack[stack.length - 1];
  if (top) { top.close(undefined); return true; }
  return false;
}

export function hasOpenModal() { return stack.length > 0; }

export function confirmDialog(message, { title = '確認', okLabel = 'OK', cancelLabel = 'キャンセル', danger = false } = {}) {
  const m = openModal({
    title, size: 'sm',
    content: h('p.modal-text', message),
    actions: [
      { label: cancelLabel, value: false },
      { label: okLabel, value: true, primary: !danger, danger, autofocus: true }
    ]
  });
  return m.done.then(v => v === true);
}

export function promptDialog(message, { title = '入力', value = '', placeholder = '', okLabel = 'OK', cancelLabel = 'キャンセル', validate } = {}) {
  const input = h('input.input', { type: 'text', value, placeholder });
  const err = h('div.form-error');
  const m = openModal({
    title, size: 'sm',
    content: h('div', message ? h('p.modal-text', message) : null, input, err),
    actions: [
      { label: cancelLabel, value: null },
      {
        label: okLabel, primary: true,
        onClick: (api) => {
          const v = input.value.trim();
          const msg = validate ? validate(v) : (v ? '' : '入力してください');
          if (msg) { err.textContent = msg; input.focus(); return false; }
          api.close(v);
          return false;
        }
      }
    ]
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); m.box.querySelector('.btn-primary').click(); }
  });
  return m.done.then(v => (typeof v === 'string' ? v : null));
}
