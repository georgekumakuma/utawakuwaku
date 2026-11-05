// どこでも貼り付け・ドロップ: YouTube の URL・セットリスト・CSV・共有バンクの URL を、
// 画面のどこに貼っても（ドロップしても）適切な追加画面が開く

import { h, icon, isTypingTarget } from './dom.js';
import { classifyText } from '../core/intake.js';
import { hasOpenModal } from './dialog.js';
import { openAddModal } from './addmodal.js';
import { openAddBankDialog } from './sharedbank.js';
import * as actions from '../app/actions.js';
import { toast, toastError } from './toast.js';

function route(text, { via }) {
  const c = classifyText(text);
  if (!c) return false;
  if (c.kind === 'url') openAddModal('url', { url: c.url });
  else if (c.kind === 'setlist') openAddModal('setlist', { url: c.url, text: c.text });
  else if (c.kind === 'csv') openAddModal('file', { text: c.text });
  else if (c.kind === 'bank') openAddBankDialog(c.url);
  toast(via === 'paste' ? '貼り付けた内容から追加画面を開きました' : 'ドロップした内容から追加画面を開きました', { duration: 1800 });
  return true;
}

export function installDropIn() {
  // 貼り付け（入力欄の外で Ctrl+V / ⌘V）
  document.addEventListener('paste', (e) => {
    if (isTypingTarget(document.activeElement) || hasOpenModal()) return;
    if (document.querySelector('.quiz, .theater')) return;
    const text = e.clipboardData && e.clipboardData.getData('text');
    if (text && route(text, { via: 'paste' })) e.preventDefault();
  });

  // ドロップ
  const overlay = h('div.drop-overlay', { 'aria-hidden': 'true' },
    h('div.drop-card', icon('upload', 'drop-ic'), h('b', 'ドロップして追加'), h('span', 'YouTube の URL・セットリスト・CSV・バックアップ（JSON）')));
  document.body.appendChild(overlay);
  let internal = false;   // アプリ内のドラッグ（プレイリストの並べ替えなど）は対象外
  let depth = 0;
  document.addEventListener('dragstart', () => { internal = true; });
  document.addEventListener('dragend', () => { internal = false; });
  const accepts = (e) => {
    if (internal || hasOpenModal()) return false;
    const types = Array.from((e.dataTransfer && e.dataTransfer.types) || []);
    return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain');
  };
  window.addEventListener('dragenter', (e) => {
    if (!accepts(e)) return;
    depth++;
    overlay.classList.add('show');
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.classList.remove('show');
  });
  window.addEventListener('dragover', (e) => {
    if (!accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('drop', async (e) => {
    depth = 0;
    overlay.classList.remove('show');
    if (!accepts(e)) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) {
      for (const f of files) {
        try { await actions.importFile(f); } catch (err) { toastError(`${f.name}: ${err.message}`); }
      }
      return;
    }
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (!route(text, { via: 'drop' })) toast('YouTube の URL・セットリスト・CSV をドロップしてください', { duration: 2500 });
  });
}
