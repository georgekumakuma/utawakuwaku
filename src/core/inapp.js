// アプリ内ブラウザ（X / LINE / Instagram / Facebook / TikTok など）の判定と、外へ出るための URL を作る。
// アプリ内ブラウザでは「別タブで開く」が同じ画面での移動になり、戻れなくなることがある。

const NAMED = [
  [/Twitter|TwitterAndroid|\bX\/\d/i, 'X'],
  [/\bLine\//i, 'LINE'],
  [/Instagram/i, 'Instagram'],
  [/Barcelona/i, 'Threads'],
  [/FBAN|FBAV|FB_IAB|FBIOS/i, 'Facebook'],
  [/musical_ly|TikTok|BytedanceWebview|ByteLocale/i, 'TikTok'],
  [/KAKAOTALK/i, 'KakaoTalk'],
  [/Discord/i, 'Discord']
];

export function platformOf(ua = '') {
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  return 'other';
}

/** アプリ内ブラウザなら { name, platform }、そうでなければ null */
export function detectInApp(ua = '') {
  if (!ua || /Electron/i.test(ua)) return null;
  const platform = platformOf(ua);
  for (const [re, name] of NAMED) if (re.test(ua)) return { name, platform };
  // 名前のわからない埋め込みブラウザ（Android WebView / iOS WKWebView）
  if (platform === 'android' && /; wv\)/.test(ua)) return { name: '', platform };
  if (platform === 'ios' && /AppleWebKit/.test(ua) && !/Safari\//.test(ua)) return { name: '', platform };
  return null;
}

function splitUrl(url) {
  const u = new URL(url);
  return { scheme: u.protocol.replace(':', ''), rest: u.host + u.pathname + u.search + u.hash };
}

/** Android: 指定アプリで開く intent:// URL（失敗時の移動先は付けない＝その場に留まる） */
export function androidIntent(url, pkg) {
  const { scheme, rest } = splitUrl(url);
  return `intent://${rest}#Intent;scheme=${scheme};package=${pkg};end`;
}

/** 普通のブラウザ（Chrome / Safari）で開く URL。対応できない環境なら null */
export function browserUrl(url, platform) {
  if (platform === 'android') return androidIntent(url, 'com.android.chrome');
  if (platform === 'ios') { const { scheme, rest } = splitUrl(url); return `x-safari-${scheme}://${rest}`; }
  return null;
}

/** YouTube アプリで開く URL。YouTube 以外の URL や対応できない環境なら null */
export function youtubeAppUrl(url, platform) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!/(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname)) return null;
  if (platform === 'android') return androidIntent(url, 'com.google.android.youtube');
  if (platform === 'ios') return `youtube://${u.host}${u.pathname}${u.search}`;
  return null;
}

// ===== アプリごとの「外へ出る」方法 =====
// X・TikTok などは、アプリ内ブラウザから他のアプリ（Chrome・YouTube）を開く操作を受け付けず、
// 「アプリケーションを開く方法がありません」などのエラーになる。そうしたアプリではボタンを出さず、
// アプリ自身のメニュー（「ブラウザで開く」）を案内する。
//   'param'  … URL に openExternalBrowser=1 を付けると外部ブラウザで開く（LINE 公式の仕組み）
//   'intent' … Android の intent:// で Chrome / YouTube アプリに渡せる
//   'guide'  … 確実な方法がない。メニューからの開き方を案内する
const NO_HANDOFF = new Set(['X', 'TikTok']);

export function escapeRoute(info) {
  if (!info) return null;
  if (info.name === 'LINE') return 'param';
  if (NO_HANDOFF.has(info.name)) return 'guide';
  if (info.platform === 'android') return 'intent';
  return 'guide';
}

/** LINE で外部ブラウザを開かせる URL（openExternalBrowser=1 を付ける） */
export function withExternalParam(url) {
  const u = new URL(url);
  u.searchParams.set('openExternalBrowser', '1');
  return u.href;
}

/** アプリのメニューから普通のブラウザで開く手順（各アプリの画面は変わることがあるので目安） */
export function menuSteps(info) {
  const ios = info && info.platform === 'ios';
  const browser = ios ? 'Safari' : 'ブラウザ';
  switch (info && info.name) {
    case 'X': return ios
      ? ['画面の右上（または右下）にある「…」や共有ボタンを押す', '「Safariで開く」（または「ブラウザで開く」）を選ぶ']
      : ['画面の右上にある「⋮」を押す', '「ブラウザで開く」を選ぶ'];
    case 'LINE': return ios
      ? ['画面の右上（または右下）にある「…」や共有ボタンを押す', '「Safariで開く」を選ぶ']
      : ['画面の右上にある「⋮」を押す', '「他のアプリで開く」→ Chrome を選ぶ'];
    case 'Instagram': case 'Threads': case 'Facebook':
      return ['画面の右上にある「…」（または「⋮」）を押す', `「外部ブラウザで開く」（または「${browser}で開く」）を選ぶ`];
    case 'TikTok':
      return ['画面の右上にある「…」を押す', `「${browser}で開く」を選ぶ`];
    default:
      return ['画面のメニュー（「…」「⋮」や共有ボタン）を押す', `「${browser}で開く」「ブラウザで開く」を選ぶ`];
  }
}
