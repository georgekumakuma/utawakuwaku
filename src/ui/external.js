// 外部リンク（YouTube など）を開く窓口。
// アプリ内ブラウザ（X など）では直接移動せず、「アプリで開く／ブラウザで開く／リンクをコピー」を選んでもらう。
// そのまま移動すると、アプリ内ブラウザの画面から utawakuwaku に戻れなくなることがあるため。

import { h, icon, copyText } from './dom.js';
import { openModal } from './dialog.js';
import { toast } from './toast.js';
import { detectInApp, browserUrl, youtubeAppUrl, escapeRoute, withExternalParam, menuSteps } from '../core/inapp.js';

const BANNER_KEY = 'uta.inappBannerClosed';
let override; // テスト用

export function inAppInfo() {
  if (override !== undefined) return override;
  return detectInApp(navigator.userAgent || '');
}
export function _setInAppForTest(v) { override = v; }

function go(url) {
  // a 要素のクリックで移動（location の書き換えより、アプリ側の外部起動の処理に乗りやすい）
  const a = h('a', { href: url, rel: 'noopener' });
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 外部 URL を開く。アプリ内ブラウザでは選択ダイアログを出す */
export function openExternal(url, { label = 'リンク' } = {}) {
  const info = inAppInfo();
  if (!info) { window.open(url, '_blank', 'noopener'); return; }
  openExternalChooser(url, info, label);
}

function stepsList(info) {
  return h('ol.ext-steps', ...menuSteps(info).map(t => h('li', t)));
}

function openExternalChooser(url, info, label) {
  const where = info.name ? `${info.name} のアプリ内ブラウザ` : 'アプリ内ブラウザ';
  const route = escapeRoute(info);
  // X などの「他のアプリを開けない」アプリでは、失敗してエラーが出るボタンは出さない
  const ytApp = route === 'guide' ? null : youtubeAppUrl(url, info.platform);
  const browser = route === 'param' ? withExternalParam(url) : route === 'intent' ? browserUrl(url, info.platform) : null;
  const browserLabel = route === 'param' ? 'ブラウザで開く' : `${info.platform === 'ios' ? 'Safari' : 'Chrome'} で開く`;
  let m;
  const choice = (ic, title, sub, onClick, primary = false) =>
    h('button.ext-choice', { type: 'button', class: primary ? 'primary' : '', onclick: () => { m.close(); onClick(); } },
      icon(ic), h('span.ext-choice-text', h('b', title), h('small', sub)));
  const copy = async () => {
    const ok = await copyText(url);
    toast(ok ? 'リンクをコピーしました' : 'コピーできませんでした', { duration: 2200 });
  };
  const content = h('div.ext-chooser',
    h('p.ext-warn', `いまは${where}で表示しています。ここで${label}に移動すると、utawakuwaku に戻れなくなることがあるため、直接は開きません。`),
    h('div.ext-choices',
      ytApp ? choice('play', 'YouTube アプリで開く', 'この画面はそのまま残ります', () => go(ytApp), true) : null,
      browser ? choice('external', browserLabel, 'ふだんのブラウザに切り替えます', () => go(browser), !ytApp) : null,
      choice('link', 'リンクをコピー', 'YouTube アプリやブラウザに貼り付けて開けます', copy, !ytApp && !browser)),
    route === 'guide'
      ? h('div.ext-guide', h('p.ext-hint', `${info.name || 'このアプリ'}の中からは、他のアプリを直接開けません。utawakuwaku ごとふだんのブラウザに移るには:`), stepsList(info))
      : h('p.ext-hint', `うまく開かないときは、${info.name || 'アプリ'}の画面のメニュー（「…」など）から「ブラウザで開く」を選ぶと、utawakuwaku ごと普通のブラウザに移れます。`),
    h('code.ext-url', url));
  m = openModal({ title: `${label}を開く`, content, size: 'sm', className: 'ext-modal' });
  return m;
}

/** 「ブラウザで開く方法」の案内（X など、ボタンで外へ出られないアプリ用） */
export function openEscapeGuide(info = inAppInfo()) {
  if (!info) return null;
  const copy = async () => {
    const ok = await copyText(location.href.split('#')[0]);
    toast(ok ? 'このページのURLをコピーしました。ブラウザのアドレス欄に貼り付けてください' : 'コピーできませんでした', { duration: 3500 });
  };
  const content = h('div.ext-chooser',
    h('p.ext-warn', `${info.name || 'このアプリ'}のアプリ内ブラウザでは、YouTube へ移動すると戻れなくなったり、動作が不安定になったりすることがあります。ふだんのブラウザで開き直すのがおすすめです。`),
    h('p.ext-hint', 'アプリのメニューから開く:'),
    stepsList(info),
    h('p.ext-hint', 'メニューが見つからないときは、URL をコピーしてブラウザに貼り付けてください。'),
    h('div.ext-choices', h('button.ext-choice.primary', { type: 'button', onclick: copy }, icon('link'), h('span.ext-choice-text', h('b', 'このページのURLをコピー'), h('small', 'utawakuwaku.netlify.app')))));
  return openModal({ title: 'ふだんのブラウザで開くには', content, size: 'sm', className: 'ext-modal escape-guide' });
}

/** アプリ内ブラウザで、target=_blank のリンクをすべて openExternal 経由にする */
export function installExternalLinkGuard() {
  document.addEventListener('click', (e) => {
    if (!inAppInfo() || e.defaultPrevented) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    let url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch { return; }
    if (!/^https?:$/.test(url.protocol) || url.origin === location.origin) return;
    e.preventDefault();
    openExternal(url.href, { label: a.textContent.trim().slice(0, 24) || 'リンク' });
  }, true);
}

/** アプリ内ブラウザで開いたときの案内バー（閉じたらこのセッション中は出さない） */
export function showInAppBanner() {
  // LINE から外部ブラウザに移ったときの目印（openExternalBrowser=1）は URL から消しておく
  if (/[?&]openExternalBrowser=/.test(location.search)) {
    try { const u = new URL(location.href); u.searchParams.delete('openExternalBrowser'); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch {}
  }
  const info = inAppInfo();
  if (!info) return null;
  try { if (sessionStorage.getItem(BANNER_KEY)) return null; } catch {}
  const route = escapeRoute(info);
  const here = location.href.split('#')[0];
  let btn;
  if (route === 'param') btn = h('button.inapp-open', { type: 'button', onclick: () => { location.href = withExternalParam(here); } }, 'ブラウザで開く');
  else if (route === 'intent') btn = h('button.inapp-open', { type: 'button', onclick: () => go(browserUrl(here, info.platform)) }, 'Chromeで開く');
  else btn = h('button.inapp-open', { type: 'button', onclick: () => openEscapeGuide(info) }, 'ブラウザで開くには');
  const close = () => {
    bar.remove();
    document.body.classList.remove('has-inapp-bar');
    try { sessionStorage.setItem(BANNER_KEY, '1'); } catch {}
  };
  const bar = h('div.inapp-bar', { role: 'note' },
    h('span.inapp-text', { title: 'アプリ内ブラウザでは、YouTube などへ移動すると戻れなくなることがあります' }, `${info.name ? info.name + 'の' : ''}アプリ内ブラウザで表示中`),
    btn,
    h('button.inapp-close', { type: 'button', 'aria-label': '案内を閉じる', onclick: close }, icon('close')));
  document.body.appendChild(bar);
  document.body.classList.add('has-inapp-bar');
  return bar;
}
