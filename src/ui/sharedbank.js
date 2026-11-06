// 共有バンク: 「URLでバンクを追加」ダイアログ、読み込み・更新の操作、使い方ガイド

import { h, icon, copyText, downloadText } from './dom.js';
import { openModal, confirmDialog } from './dialog.js';
import * as store from '../core/store.js';
import { state } from '../core/store.js';
import { inspectSharedUrl, fetchSharedSongs, fetchBankCSV } from '../app/bank.js';
import { normalizeBankUrl, TEMPLATE_CSV, songsToTSV } from '../core/sharedbank.js';
import { toast, toastError, toastSuccess } from './toast.js';

// ===== 操作 =====

// 共有バンク内のプレイリストを、自分のプレイリストとして読み込む（コピー）
export async function loadSharedPlaylist(bank, preset = null) {
  const url = preset ? preset.url : bank.url;
  const songs = await fetchSharedSongs(url);
  const name = preset ? preset.name : bank.name;
  const pl = store.createPlaylist(name, songs, {
    icon: (preset && preset.icon) || bank.icon, description: (preset && preset.description) || bank.description,
    source: `shared:${bank.url}${preset ? '#' + preset.id : ''}`
  });
  if (!preset) { bank.count = songs.length; bank.fetchedAt = Date.now(); }
  store.setView('playlist');
  toastSuccess(`「${pl.name}」を読み込みました（${songs.length}曲）`);
  return pl;
}

// 読み込み元（同梱サンプル・共有バンク）がはっきりしているプレイリストか
export function sourceOf(pl) {
  if (!pl || !pl.source) return null;
  if (pl.source.startsWith('bank:')) {
    const id = pl.source.slice(5);
    const preset = (state.ui.bank || []).find(p => p.id === id);
    return preset ? { label: 'サンプル', fetch: () => fetchBankCSV(preset.file) } : null;
  }
  if (pl.source.startsWith('shared:')) {
    const rest = pl.source.slice(7);
    const [bankUrl, presetId] = rest.split('#');
    const bank = store.bankByUrl(bankUrl);
    const preset = bank && presetId ? bank.presets.find(p => p.id === presetId) : null;
    const url = preset ? preset.url : bankUrl;
    return { label: bank ? bank.name : '共有バンク', fetch: () => fetchSharedSongs(url) };
  }
  return null;
}

// 読み込み元の最新の内容で置き換える（自分の編集は失われる）
export async function refreshFromSource(pl) {
  const src = sourceOf(pl);
  if (!src) return;
  const ok = await confirmDialog(
    `「${pl.name}」を、読み込み元（${src.label}）の最新の内容で置き換えます。\nこのアプリで行った編集（追加・削除・評価など）は失われます。\n\n編集を残したい場合は、先にプレイリストを「複製」してください。`,
    { title: '最新版で更新', okLabel: '置き換える', danger: true });
  if (!ok) return;
  try {
    const songs = await src.fetch();
    store.replaceSongs(pl.id, songs);
    toastSuccess(`最新版で更新しました（${songs.length}曲）`);
  } catch (e) {
    toastError('更新できませんでした: ' + e.message);
  }
}

export async function removeSharedBank(bank) {
  const r = store.removeBank(bank.id);
  if (!r) return;
  toast(`「${bank.name}」をバンクの一覧から外しました（読み込んだプレイリストはそのまま残ります）`, {
    duration: 6000, action: { text: '元に戻す', callback: () => store.restoreBank(r.removed, r.index) }
  });
}

export function bankLink(bank) {
  return location.href.split('#')[0] + '#bank=' + encodeURIComponent(bank.url);
}

export async function copyBankLink(bank) {
  const ok = await copyText(bankLink(bank));
  toast(ok ? 'バンクの紹介リンクをコピーしました。開いた人はワンクリックでこのバンクを追加できます' : 'コピーできませんでした', { duration: 3500 });
}

export async function copyForSpreadsheet(pl) {
  const ok = await copyText(songsToTSV(pl.songs));
  toast(ok ? 'コピーしました。Googleスプレッドシートの A1 セルを選んで貼り付けてください' : 'コピーできませんでした', { duration: 4000 });
}

export function downloadTemplate() {
  downloadText('utawakuwaku_template.csv', TEMPLATE_CSV, 'text/csv');
}

// ===== ガイド =====

export function spreadsheetSteps() {
  return h('ol.guide-steps',
    h('li', 'Googleスプレッドシートで新しいシートを作り、1行目に ', h('code', 'videoId, title, start, end, rating, article'), ' と入力（', h('button.linklike', { type: 'button', onclick: downloadTemplate }, 'ひな形CSV'), ' を「ファイル」→「インポート」で読み込んでも可）'),
    h('li', '2行目から1曲1行で書く。start / end は ', h('code', '1:23:45'), ' のような形式でも秒数でもOK。このアプリで作ったリストは、プレイリストのメニュー「スプレッドシート用にコピー」で貼り付けられます'),
    h('li', 'メニューの「ファイル」→「共有」→「ウェブに公開」'),
    h('li', '公開するシートを選び、形式を「カンマ区切り形式（.csv）」にして「公開」'),
    h('li', '表示された URL をここに貼り付け。みんなに配るときは、追加後にバンクの「紹介リンクをコピー」で作ったリンクを共有')
  );
}

export function editingGuide() {
  return h('details.guide',
    h('summary', icon('info'), ' プレイリストの編集・保存・公開について'),
    h('div.guide-body',
      h('h4', '読み込んだリストは「あなたのコピー」です'),
      h('p', 'サンプルや共有バンクから読み込んだプレイリストは、左の「プレイリスト」にコピーとして追加されます。曲の追加・削除・並べ替え・区間の調整・評価など、自由に編集してかまいません。元のバンクや公開した人のシートが変わることはありません。'),
      h('h4', '保存は自動です'),
      h('p', '編集は、このブラウザの中に自動で保存されます。別の端末やブラウザでも使うときは、設定の「バックアップ（JSONで保存）」で持ち運べます。ブラウザのデータを消すと失われるので、ときどきバックアップしてください。'),
      h('h4', '新しく作るとき'),
      h('p', '「＋ 追加」から YouTube の URL を貼ると、プレイヤーを見ながら I キー（開始）/ O キー（終了）で区間を決められます。歌枠のコメント欄のタイムスタンプを「セットリスト貼り付け」に貼れば、全曲をまとめて登録できます。'),
      h('h4', '公開した人が更新したとき'),
      h('p', '共有バンクから読み込んだプレイリストは、プレイリストのメニュー「最新版で更新」で、公開されている最新の内容に置き換えられます（このアプリで行った編集は上書きされます。残したいときは先に「複製」してください）。'),
      h('h4', '自分のリストを公開するとき'),
      h('p', 'プレイリストのメニュー「スプレッドシート用にコピー」→ Googleスプレッドシートに貼り付け →「ウェブに公開」。その URL を「URLでバンクを追加」で登録し、「紹介リンクをコピー」で共有します。1曲だけ・1回だけ渡すなら「共有URLをコピー」でも足ります（こちらは送った時点の内容で、あとから更新されません）。'),
      h('p.hint', 'URL を知っている人は誰でも中身を見られます。個人的なメモなどは書かないでください。公開を取り消すと、そのバンクは読み込めなくなります。')
    )
  );
}

// ===== 「URLでバンクを追加」ダイアログ =====

export function openAddBankDialog(initialUrl = '') {
  const input = h('input.input', { type: 'url', placeholder: 'https://docs.google.com/spreadsheets/d/e/…/pub?output=csv', value: initialUrl, autocomplete: 'off' });
  const result = h('div.bank-inspect');
  const nameInput = h('input.input', { type: 'text', placeholder: 'バンクの名前（例: ○○さん 歌枠セトリ集）' });
  const nameField = h('div.field', { style: { display: 'none' } }, h('label', '名前'), nameInput);
  let inspected = null;

  const btnCheck = h('button.btn.btn-ghost', { type: 'button', onclick: () => check() }, icon('search'), ' 確認');
  let footerAdd = null;
  const setAddEnabled = (on) => { if (footerAdd) footerAdd.disabled = !on; };

  async function check() {
    const url = input.value.trim();
    inspected = null;
    setAddEnabled(false);
    nameField.style.display = 'none';
    if (!normalizeBankUrl(url)) { result.replaceChildren(h('div.form-error', 'https:// で始まる URL を貼り付けてください')); return; }
    const existing = store.bankByUrl(url);
    result.replaceChildren(h('div.hint', '読み込み中…'));
    btnCheck.disabled = true;
    try {
      const r = await inspectSharedUrl(url);
      inspected = { url, ...r };
      if (r.kind === 'bank') {
        result.replaceChildren(h('div.inspect-ok', icon('check'), ` バンク（${r.presets.length}個のプレイリスト）`),
          h('ul.inspect-list', ...r.presets.slice(0, 8).map(p => h('li', `${p.icon} ${p.name}`)), r.presets.length > 8 ? h('li', `ほか${r.presets.length - 8}個`) : null));
        nameInput.value = existing ? existing.name : (r.name || '');
      } else {
        result.replaceChildren(h('div.inspect-ok', icon('check'), ` プレイリスト（${r.songs.length}曲）`),
          h('ul.inspect-list', ...r.songs.slice(0, 5).map(s => h('li', s.title || s.videoId)), r.songs.length > 5 ? h('li', `ほか${r.songs.length - 5}曲`) : null));
        nameInput.value = existing ? existing.name : '';
      }
      if (existing) result.appendChild(h('div.hint', 'このURLは登録済みです。追加すると情報が更新されます'));
      nameField.style.display = '';
      setAddEnabled(true);
      if (!nameInput.value) nameInput.focus();
    } catch (e) {
      result.replaceChildren(h('div.form-error', e.message));
    } finally {
      btnCheck.disabled = false;
    }
  }

  function add() {
    if (!inspected) return;
    const name = nameInput.value.trim() || (inspected.kind === 'bank' ? 'みんなのバンク' : '共有プレイリスト');
    const b = store.saveBank({
      url: inspected.url, name, kind: inspected.kind,
      description: inspected.description || '',
      presets: inspected.kind === 'bank' ? inspected.presets : [],
      count: inspected.kind === 'csv' ? inspected.songs.length : 0,
      fetchedAt: Date.now()
    });
    modal.close();
    store.setView('bank');
    toastSuccess(`「${b.name}」をバンクに追加しました`);
  }

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
  input.addEventListener('paste', () => setTimeout(check, 0));

  const content = h('div.addbank',
    h('p.modal-text', '他の人が公開したプレイリストの URL を登録すると、「バンク」画面からいつでも読み込めるようになります。公開した人が内容を更新すると、ここにも反映されます。'),
    h('div.field', h('label', '公開されている URL'), h('div.field-row', input, btnCheck)),
    result, nameField,
    h('details.guide', { open: !initialUrl },
      h('summary', icon('info'), ' 自分で公開するには（Googleスプレッドシートがおすすめ）'),
      h('div.guide-body', spreadsheetSteps(),
        h('p.hint', 'Googleドライブに置いた CSV ファイルは、Google の制限でブラウザから直接読み込めません。スプレッドシートの「ウェブに公開」を使ってください。GitHub や Gist、自分のサイトに置いた CSV / playlistbank.json の URL も使えます。')))
  );
  const modal = openModal({
    title: 'URLでバンクを追加', content, size: 'md',
    actions: [{ label: 'キャンセル' }, { label: 'バンクに追加', primary: true, keepOpen: true, onClick: () => { add(); return false; } }]
  });
  footerAdd = modal.box.querySelector('.modal-footer .btn-primary');
  setAddEnabled(false);
  if (initialUrl) check();
  return modal;
}
