// キーボードショートカットのヘルプ

import { h } from './dom.js';
import { openModal } from './dialog.js';
import { modKey } from '../app/context.js';

export const SHORTCUTS = [
  ['再生', [
    ['Space', '再生 / 一時停止'], ['→ / ←', '次の曲 / 前の曲'], ['Shift + → / ←', '10秒送り / 戻し'],
    ['S', 'シャッフル'], ['R', 'リピート切替（全曲 → 1曲 → OFF）'], ['M', 'ミュート'], ['↑ / ↓（リスト外）', '音量 ±5'],
    ['V', '映像を隠す / 表示'], ['T', 'シアターモード（全画面）'], ['L', '再生中の曲までスクロール']
  ]],
  ['リスト', [
    ['↑ / ↓', '曲の選択を移動'], ['Enter', '選択した曲を再生'], ['Shift + クリック / ↑↓', '範囲選択'], [`${modKey()} + クリック`, '追加選択'],
    [`${modKey()} + A`, 'すべて選択'], ['Delete / Backspace', '選択した曲を削除'], ['E', '選択中（または再生中）の曲を編集'], ['N', '「次に再生」に追加']
  ]],
  ['編集', [
    ['I', '再生位置を開始時間に設定'], ['O', '再生位置を終了時間に設定'], [`${modKey()} + Enter`, '保存'], ['Esc', 'パネル / ダイアログを閉じる']
  ]],
  ['全般', [
    ['/', '検索'], [`${modKey()} + V（入力欄の外）`, 'URL・セットリスト・CSV を貼り付けて追加'], [`${modKey()} + K`, 'コマンドパレット'], ['Q', 'キューを表示'], ['A', '曲を追加'], ['?', 'このヘルプ']
  ]]
];

export function openHelp() {
  const content = h('div.help-grid', ...SHORTCUTS.map(([sec, rows]) =>
    h('div.help-sec', h('h4', sec), h('table', ...rows.map(([k, d]) => h('tr', h('td', h('kbd', k)), h('td', d)))))
  ));
  openModal({ title: 'キーボードショートカット', content, size: 'lg' });
}
