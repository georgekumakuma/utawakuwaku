// 設定モーダル

import { h, icon } from './dom.js';
import { openModal, confirmDialog } from './dialog.js';
import { state, commit } from '../core/store.js';
import * as store from '../core/store.js';
import * as actions from '../app/actions.js';
import { ctx } from '../app/context.js';
import { ACCENTS } from './theme.js';
import { refreshColors } from './ambient.js';
import { toastSuccess } from './toast.js';
import { setWakeLockWanted } from '../app/wakelock.js';

function row(label, control, desc) {
  return h('div.setting-row', h('div.setting-text', h('div.setting-label', label), desc ? h('div.setting-desc', desc) : null), h('div.setting-control', control));
}

function toggle(key, onChange) {
  const input = h('input', { type: 'checkbox', checked: !!state.settings[key] });
  input.addEventListener('change', () => { store.setSetting(key, input.checked); onChange && onChange(input.checked); });
  return h('label.switch', input, h('span.switch-track'));
}

export function openSettings() {
  const e = ctx.engine;
  const themeSel = h('select.select', ...[['dark', 'ダーク'], ['light', 'ライト'], ['auto', 'OSに合わせる']].map(([v, l]) => h('option', { value: v, selected: state.settings.theme === v }, l)));
  themeSel.addEventListener('change', () => { store.setSetting('theme', themeSel.value); refreshColors(); });
  const accents = h('div.accent-grid', ...Object.entries(ACCENTS).map(([k, a]) =>
    h('button.accent-dot', { type: 'button', title: a.label, class: state.settings.accent === k ? 'on' : '', style: { background: `linear-gradient(135deg, ${a.from}, ${a.to})` },
      onclick: (ev) => { store.setSetting('accent', k); refreshColors(); ev.currentTarget.parentElement.querySelectorAll('.accent-dot').forEach(d => d.classList.toggle('on', d === ev.currentTarget)); } })));

  const cf = h('input', { type: 'range', min: 0, max: 8, step: 0.5, value: state.settings.crossfade });
  const cfVal = h('span.mono', `${state.settings.crossfade}s`);
  cf.addEventListener('input', () => { cfVal.textContent = `${cf.value}s`; });
  cf.addEventListener('change', () => { const v = parseFloat(cf.value); store.setSetting('crossfade', v); e && e.setCrossfade(v); });

  const usage = h('span.hint', '計測中…');
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(est => { usage.textContent = `使用中: ${Math.round((est.usage || 0) / 1024)} KB`; }).catch(() => { usage.textContent = ''; });
  } else usage.textContent = '';

  const content = h('div.settings',
    h('h4.settings-h', '外観'),
    row('テーマ', themeSel),
    row('アクセントカラー', accents),
    row('曲に合わせて色を変える', toggle('artworkColor', () => refreshColors()), '再生中の曲のサムネイルから色を読み取り、アクセントカラーと背景の光に使います（オフでは上のアクセントカラーを使用）'),
    row('オーロラ背景', toggle('aurora'), 'シアターモード・クイズの背景を動かします（動きを減らす設定の端末では自動で静止）'),
    row('コンパクトな行', toggle('compactRows'), '曲リストの行を詰めて表示'),
    h('h4.settings-h', '再生'),
    row('クロスフェード', h('div.range-row', cf, cfVal), '曲と曲のつなぎ目を重ねる秒数。0で重ねない'),
    row('先読み（ギャップレス）', toggle('gapless', v => e && e.setGapless(v)), '次の曲を裏のプレイヤーで先に読み込み、切り替えを途切れさせない'),
    row('映像を表示', toggle('showVideo'), 'オフにすると音声中心のコンパクト表示（V キー）'),
    row('画面をスリープさせない', toggle('keepScreenAwake', v => setWakeLockWanted(v)), '再生中にスマホの画面が消えないようにする（対応ブラウザのみ）'),
    h('h4.settings-h', 'データ'),
    row('複数曲の削除時に確認', toggle('confirmDelete')),
    row('バックアップ', h('div.btn-row', h('button.btn.btn-ghost.sm', { type: 'button', onclick: () => actions.exportAllJSON() }, icon('download'), ' JSONで保存'),
      h('button.btn.btn-ghost.sm', { type: 'button', onclick: async () => { const { openAddModal } = await import('./addmodal.js'); openAddModal('file'); } }, icon('upload'), ' 読み込む')),
      'すべてのプレイリストと設定をひとつのファイルに保存。別の端末やブラウザへの引っ越しに'),
    row('ストレージ', usage, 'データはこのブラウザの IndexedDB に保存されます（サーバーには送信しません）'),
    row('すべてのデータを消去', h('button.btn.btn-ghost.sm.danger', { type: 'button', onclick: async () => {
      if (!(await confirmDialog('すべてのプレイリスト・履歴・設定を消去します。元に戻せません。よろしいですか？', { okLabel: '消去する', danger: true }))) return;
      if (!(await confirmDialog('本当に消去しますか？（先にバックアップを保存することをおすすめします）', { okLabel: '消去する', danger: true }))) return;
      state.data.playlists = [];
      state.history = [];
      const { newPlaylist } = await import('../core/model.js');
      const pl = newPlaylist('マイリスト');
      state.data.playlists.push(pl); state.data.currentId = pl.id;
      commit('data', 'history', 'ui');
      if (e) e.stop();
      toastSuccess('データを消去しました');
    } }, icon('trash'), ' 消去')),
    h('h4.settings-h', 'YouTube Premium・広告について'),
    h('p.settings-note', 'このアプリはYouTube公式の埋め込みプレイヤーをそのまま使っています。広告が出るかどうかは、このブラウザがyoutube.comのログインCookieを埋め込みプレイヤーへ渡せるかで決まります。Premium会員なのに広告が出る場合は、ブラウザのCookie設定で「[*.]youtube.com」を常に許可してください（サードパーティCookieのブロックが原因です）。Electron版（.exe）はログインできないため、常に広告が表示されます。'),
    h('p.settings-note.muted', `utawakuwaku v3 · ${ctx.isElectron ? 'Electron' : 'Browser'}${navigator.userAgent.includes('Mobile') ? ' · Mobile' : ''}`)
  );
  openModal({ title: '設定', content, size: 'md' });
}
