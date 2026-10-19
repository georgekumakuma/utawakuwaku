// コンテキストメニュー / ドロップダウンメニュー

import { h, icon } from './dom.js';

let current = null;

export function closeMenu() {
  if (current) { current.remove(); current = null; }
  document.removeEventListener('mousedown', onDocDown, true);
  document.removeEventListener('keydown', onDocKey, true);
  window.removeEventListener('resize', closeMenu);
  window.removeEventListener('blur', closeMenu);
}

function onDocDown(e) { if (current && !current.contains(e.target)) closeMenu(); }
function onDocKey(e) {
  if (!current) return;
  if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
  const items = Array.from(current.querySelectorAll('.menu-item:not([disabled])'));
  const idx = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); (items[idx + 1] || items[0])?.focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); (items[idx - 1] || items[items.length - 1])?.focus(); }
}

// items: [{label, icon, onClick, disabled, danger, checked, hint}] / 'sep' / {label, submenu:[...]}
export function showMenu(items, { x, y, anchor } = {}) {
  closeMenu();
  const menu = h('div.menu', { role: 'menu' });
  for (const it of items) {
    if (it === 'sep' || it === '-') { menu.appendChild(h('div.menu-sep')); continue; }
    if (!it) continue;
    if (it.heading) { menu.appendChild(h('div.menu-heading', it.heading)); continue; }
    const btn = h('button.menu-item', {
      type: 'button', role: 'menuitem', disabled: !!it.disabled,
      class: `${it.danger ? 'danger' : ''} ${it.checked ? 'checked' : ''}`
    },
      h('span.menu-ic', it.icon ? icon(it.icon) : (it.checked ? icon('check') : null)),
      h('span.menu-label', it.label),
      it.hint ? h('span.menu-hint', it.hint) : null,
      it.submenu ? icon('chevronRight', 'menu-arrow') : null
    );
    if (it.submenu) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const r = btn.getBoundingClientRect();
        showMenu(it.submenu, { x: r.right + 2, y: r.top });
      });
    } else {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenu();
        it.onClick && it.onClick(e);
      });
    }
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  current = menu;

  let px = x, py = y;
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    px = r.left; py = r.bottom + 4;
  }
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  if (px + mw > vw - 8) px = Math.max(8, vw - mw - 8);
  if (py + mh > vh - 8) py = Math.max(8, (anchor ? anchor.getBoundingClientRect().top - mh - 4 : vh - mh - 8));
  menu.style.left = px + 'px';
  menu.style.top = py + 'px';
  requestAnimationFrame(() => menu.classList.add('show'));

  setTimeout(() => {
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onDocKey, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('blur', closeMenu);
  }, 0);
  const first = menu.querySelector('.menu-item:not([disabled])');
  if (first && !('ontouchstart' in window)) first.focus();
  return menu;
}
