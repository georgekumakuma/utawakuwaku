// エントリーポイント: ストア初期化 → UI 構築 → 再生エンジン起動

import * as store from '../core/store.js';
import { state, commit } from '../core/store.js';
import { Engine } from '../player/engine.js';
import { ctx } from './context.js';
import * as actions from './actions.js';
import { mountSidebar } from '../ui/sidebar.js';
import { mountTopbar } from '../ui/topbar.js';
import { mountStage } from '../ui/stage.js';
import { mountViews } from '../ui/views.js';
import { mountPanel } from '../ui/panel.js';
import { mountPlayerbar } from '../ui/playerbar.js';
import { installShortcuts } from '../ui/shortcuts.js';
import { applyTheme, watchSystemTheme } from '../ui/theme.js';
import { decodeShare } from '../core/share.js';
import { toast, toastError, toastSuccess } from '../ui/toast.js';
import { confirmDialog, openModal } from '../ui/dialog.js';
import { h, icon } from '../ui/dom.js';
import { requestPersistence } from '../core/storage.js';
import { thumbUrl } from '../core/ytid.js';
import { hasValidEnd } from '../core/model.js';
import { listBankPresets } from './bank.js';
import * as wakelock from './wakelock.js';
import { openAddModal } from '../ui/addmodal.js';
import { openAddBankDialog } from '../ui/sharedbank.js';
import { mountAmbient, refreshColors } from '../ui/ambient.js';
import { installDropIn } from '../ui/dropin.js';

function $(id) { return document.getElementById(id); }

function updateMediaSession(song) {
  if (!('mediaSession' in navigator) || !song) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title || 'utawakuwaku',
      artist: song.artist || song.singer || song.article || 'utawakuwaku',
      album: song.article || '',
      artwork: [
        { src: thumbUrl(song.videoId, 'mqdefault'), sizes: '320x180', type: 'image/jpeg' },
        { src: thumbUrl(song.videoId, 'hqdefault'), sizes: '480x360', type: 'image/jpeg' }
      ]
    });
  } catch { /* ignore */ }
}

function installMediaSessionHandlers(engine) {
  if (!('mediaSession' in navigator)) return;
  const set = (name, fn) => { try { navigator.mediaSession.setActionHandler(name, fn); } catch { /* unsupported */ } };
  set('play', () => engine.play());
  set('pause', () => engine.pause());
  set('previoustrack', () => engine.prev());
  set('nexttrack', () => engine.next());
  set('seekbackward', (d) => engine.seekBy(-(d.seekOffset || 10)));
  set('seekforward', (d) => engine.seekBy(d.seekOffset || 10));
  set('seekto', (d) => { if (d.seekTime != null) { const s = engine.state.song; if (s) engine.seek(s.start + d.seekTime); } });
  engine.on('change', () => {
    try { navigator.mediaSession.playbackState = engine.state.status === 'playing' ? 'playing' : (engine.state.status === 'paused' ? 'paused' : 'none'); } catch { /* ignore */ }
  });
  engine.on('tick', (t) => {
    const s = engine.state.song;
    if (!s || !('setPositionState' in navigator.mediaSession)) return;
    const end = hasValidEnd(s) ? s.end : t.duration;
    if (!(end > s.start)) return;
    try { navigator.mediaSession.setPositionState({ duration: end - s.start, playbackRate: engine.state.rate, position: Math.max(0, Math.min(end - s.start, t.cur - s.start)) }); } catch { /* ignore */ }
  });
}

async function importFromHash() {
  if (location.hash.startsWith('#bank=')) {
    // 共有バンクの紹介リンク: 中身を確認してから追加するダイアログを開く
    const url = decodeURIComponent(location.hash.slice(6));
    history.replaceState(null, '', location.pathname + location.search);
    store.setView('bank');
    openAddBankDialog(url);
    return true;
  }
  if (!location.hash || !/^#pl2?u?=/.test(location.hash)) return false;
  const hash = location.hash;
  history.replaceState(null, '', location.pathname + location.search);
  const shared = await decodeShare(hash);
  if (!shared || !shared.songs.length) { toastError('共有URLを読み込めませんでした'); return false; }
  const name = shared.name || '共有プレイリスト';
  const ok = await confirmDialog(`共有されたプレイリスト「${name}」（${shared.songs.length}曲）を取り込みますか？\n新しいプレイリストとして追加されます。`, { title: '共有プレイリスト', okLabel: '取り込む' });
  if (!ok) return false;
  const pl = store.createPlaylist(name, shared.songs, { source: 'share' });
  store.setView('playlist');
  toastSuccess(`「${pl.name}」を取り込みました`);
  return true;
}

function showWelcome() {
  const content = h('div.welcome',
    h('p', 'YouTube の動画から「ここからここまで」を切り出して、曲のように並べて聴くアプリです。曲を増やす方法は3つ:'),
    h('div.welcome-grid',
      h('div.welcome-card', icon('video'), h('b', 'URLを貼る'), h('span', 'プレイヤーを見ながら I / O キーで開始・終了を打刻')),
      h('div.welcome-card', icon('text'), h('b', 'セットリストを貼る'), h('span', '「1:23:45 曲名」形式のコメントを貼るだけで全曲を一括登録')),
      h('div.welcome-card', icon('bank'), h('b', 'バンクから選ぶ'), h('span', 'サンプルや、ファンの方が公開した共有バンクを読み込んで、すぐに聴き始める'))
    ),
    h('p.hint', 'データはこのブラウザの中にだけ保存されます。設定 → バックアップで JSON に保存できます。')
  );
  openModal({
    title: 'utawakuwaku へようこそ', content, size: 'md',
    actions: [
      { label: 'バンクを見る', onClick: () => store.setView('bank') },
      { label: '曲を追加する', onClick: () => openAddModal() },
      { label: 'はじめる', primary: true, autofocus: true }
    ]
  });
  store.setSetting('seenWelcome', true);
  store.setSetting('seenV3', true);
}

function showWhatsNew() {
  const card = (ic, title, desc, label, run) => h('button.whatsnew-card', { type: 'button', onclick: () => { m.close(); run(); } },
    h('span.whatsnew-ic', icon(ic)), h('b', title), h('span', desc), h('span.whatsnew-go', label, ' →'));
  const content = h('div.whatsnew',
    h('p', '聴く・遊ぶ・眺める、がもっと楽しくなりました。'),
    h('div.whatsnew-grid',
      card('theater', 'シアターモード', '曲の色に染まるオーロラの中で、画面いっぱいに。スマホではミニプレイヤーをタップ', 'T キーで開く', () => import('../ui/theater.js').then(x => x.openTheater())),
      card('game', 'イントロクイズ', '数秒聴いて4択で曲名当て。コンボとハイスコアつき', '遊んでみる', () => import('../ui/quiz.js').then(x => x.openQuizSetup())),
      card('radio', 'おまかせラジオ', '評価が高い曲・しばらく聴いていない曲を中心に自動選曲', '再生する', () => actions.playRadio()),
      card('timeline', '配信アーカイブ', '配信ごとに、登録した曲をタイムラインで一望。すき間をクリックで追加', '開く', () => store.setView('archive'))
    ),
    h('p.hint', 'ほかにも: 曲のサムネイルに合わせて色が変わります（設定でオフ可）。YouTube の URL やセットリストは、画面のどこに貼り付けても・ドロップしても追加できます。')
  );
  const m = openModal({ title: '✨ utawakuwaku v3 の新機能', content, size: 'lg', actions: [{ label: 'あとで', primary: true }] });
  store.setSetting('seenV3', true);
}

async function main() {
  applyTheme();
  const boot = await store.init();
  applyTheme();
  watchSystemTheme(() => refreshColors());
  requestPersistence();

  const engine = new Engine({ deckIds: ['deckA', 'deckB'] });
  ctx.engine = engine;
  const s = state.settings;
  Object.assign(engine.state, {
    volume: s.volume, muted: s.muted, rate: s.rate, crossfade: s.crossfade,
    gapless: s.gapless, repeat: s.repeat, shuffle: s.shuffle
  });

  // UI
  mountSidebar($('sidebar'));
  const topbar = mountTopbar($('topbar'));
  mountStage($('stage'));
  const views = mountViews($('content'));
  const editor = mountPanel($('panel'));
  mountPlayerbar($('playerbar'));
  mountAmbient();
  installDropIn();
  installShortcuts({ focusSearch: topbar.focusSearch, views, editor });
  $('splash').classList.add('hide');
  setTimeout(() => $('splash').remove(), 600);

  // エンジンのイベント
  engine.on('songstart', ({ song, playlistId }) => {
    if (song._draft) return;
    const pl = playlistId ? store.playlistById(playlistId) : null;
    store.recordPlay(song, pl);
    updateMediaSession(song);
  });
  engine.on('change', () => {
    document.body.classList.toggle('is-playing', engine.state.status === 'playing' || engine.state.status === 'preview');
    wakelock.sync(engine.state.status === 'playing');
  });
  engine.on('error', ({ code, message, song }) => {
    if (song && !song._draft) {
      if (code === 100 || code === 2) actions.markBroken(song.videoId, 'missing');
      else if (code === 101 || code === 150) actions.markBroken(song.videoId, 'restricted');
    }
    toastError(`⚠️ ${message}${song ? `：${song.title}` : ''}`, {
      action: song ? { text: 'YouTubeで開く', callback: () => actions.openOnYouTube(song) } : null
    });
  });
  engine.on('playing', () => {
    const s = engine.state.song;
    if (s && !s._draft && s.broken) actions.markBroken(s.videoId, '');
  });
  engine.on('notice', (msg) => toast(msg, { duration: 2500 }));
  let sleptAt = 0;
  engine.on('sleep', () => {
    sleptAt = performance.now();
    actions.clearSleepState();
    toast('スリープタイマー: この曲の終わりで停止しました', { duration: 4000 });
  });
  engine.on('finish', () => {
    if (performance.now() - sleptAt < 500) return;
    toast('プレイリストの最後まで再生しました', { duration: 2000 });
  });
  installMediaSessionHandlers(engine);
  // 動画の長さを覚えておく（配信アーカイブのタイムラインに使う）
  engine.on('tick', (t) => {
    const s = engine.state.song;
    if (!s || !(t.duration > 0) || engine.state.status !== 'playing') return;
    const vd = engine.videoData();
    if (vd && vd.video_id === s.videoId) store.rememberDuration(s.videoId, t.duration);
  });

  // プレイリスト編集を再生コンテキストに反映
  store.on('data', () => {
    if (!engine.state.context.length) return;
    const plId = engine.state.playlistId;
    const pl = plId ? store.playlistById(plId) : null;
    if (pl && engine.contextSource === plId) {
      engine.syncContext(actions.itemsOfPlaylist(pl));
    } else {
      const items = engine.state.context.filter(it => store.findSong(it.song.id));
      if (items.length !== engine.state.context.length) engine.syncContext(items);
    }
  });
  const origSetContext = engine.setContext.bind(engine);
  engine.setContext = (items, startId, opts) => {
    // コンテキストが「あるプレイリスト全体」なら、その後の編集を追従させる
    const plIds = new Set(items.map(it => it.playlistId));
    const pl = plIds.size === 1 ? store.playlistById(items[0].playlistId) : null;
    engine.contextSource = pl && pl.songs.length === items.length && pl.songs.every((s, i) => items[i].song === s) ? pl.id : null;
    return origSetContext(items, startId, opts);
  };

  // 起動メッセージ
  if (boot.source === 'default') toast(`デフォルトプレイリストを読み込みました（${boot.count}曲）`, { duration: 3000 });
  else if (boot.source === 'migrated') toast('以前のデータを新しい形式に移行しました', { duration: 3000 });

  // バンク一覧は先に取得しておく（サイドバー等で使う）
  listBankPresets().then(b => { state.ui.bank = b; commit('ui'); });

  // 共有URL
  const imported = await importFromHash();
  if (!imported && !state.settings.seenWelcome) showWelcome();
  else if (!imported && !state.settings.seenV3) showWhatsNew();

  // YouTube プレイヤー
  try {
    await engine.init();
    state.ui.playerReady = true;
    commit('ui');
    if (state.settings.keepScreenAwake) wakelock.setWakeLockWanted(true);
  } catch (e) {
    state.ui.playerError = e.message;
    commit('ui');
    const banner = $('player-banner');
    banner.textContent = `⚠️ ${e.message} — プレイリストの編集はできますが、再生にはネットワーク接続と youtube.com へのアクセスが必要です。`;
    banner.style.display = '';
  }

  // Service Worker（PWA）
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol) && !ctx.isElectron) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* ignore */ });
  }

  window.addEventListener('beforeunload', () => { store.flush(); });
  window.addEventListener('hashchange', () => { importFromHash(); });

  // 開発者コンソールやテストから触れるようにする
  window.__uta = { engine, store, actions, state };
}

main().catch(err => {
  console.error(err);
  const splash = $('splash');
  if (splash) splash.innerHTML = `<div class="splash-error">起動に失敗しました: ${err.message}<br><small>ブラウザのコンソールを確認してください</small></div>`;
});
