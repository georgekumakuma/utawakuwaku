// Service Worker: アプリ本体（HTML/CSS/JS/同梱CSV）をキャッシュし、オフラインでも起動できるようにする。
// YouTube 関連（youtube.com / ytimg.com）はキャッシュしない。

const VERSION = 'utawakuwaku-v3.0.0';
const SHELL = [
  './', './index.html', './styles/app.css', './manifest.webmanifest', './icon.png',
  './src/app/app.js', './src/app/actions.js', './src/app/bank.js', './src/app/context.js', './src/app/songmenu.js', './src/app/wakelock.js',
  './src/core/color.js', './src/core/csv.js', './src/core/insights.js', './src/core/intake.js', './src/core/quiz.js', './src/core/model.js', './src/core/setlist.js', './src/core/sharedbank.js', './src/core/share.js', './src/core/storage.js', './src/core/store.js', './src/core/time.js', './src/core/ytid.js',
  './src/player/engine.js', './src/player/yt.js',
  './src/ui/addmodal.js', './src/ui/ambient.js', './src/ui/aurora.js', './src/ui/confetti.js', './src/ui/dropin.js', './src/ui/quiz.js', './src/ui/theater.js', './src/ui/dialog.js', './src/ui/dom.js', './src/ui/editor.js', './src/ui/help.js', './src/ui/menu.js', './src/ui/palette.js',
  './src/ui/panel.js', './src/ui/playerbar.js', './src/ui/settings.js', './src/ui/sharedbank.js', './src/ui/shortcuts.js', './src/ui/sidebar.js', './src/ui/songlist.js',
  './src/ui/stage.js', './src/ui/theme.js', './src/ui/toast.js', './src/ui/topbar.js', './src/ui/views.js',
  './playlists/utawakuwaku_playlist_default.csv', './playlists/samples/playlistbank.json', './playlists/shared-directory.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // YouTube や外部はそのまま
  // ネットワーク優先、失敗時はキャッシュ（更新を素早く反映しつつオフラインでも動く）
  event.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
