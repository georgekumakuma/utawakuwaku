// アプリ内ブラウザ（X / LINE / Instagram / Facebook / TikTok など）の判定と、外へ出るための URL を作る。
// アプリ内ブラウザでは「別タブで開く」が同じ画面での移動になり、戻れなくなることがある。

const NAMED = [
  [/Twitter|TwitterAndroid|\bX\/\d/i, 'X'],
  [/\bLine\//i, 'LINE'],
  [/Instagram/i, 'Instagram'],
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
