// 画面スリープ防止（Screen Wake Lock API）。再生中のみ保持する。

let lock = null;
let wanted = false;

export async function setWakeLockWanted(on) {
  wanted = !!on;
  await sync(true);
}

export async function sync(playing) {
  try {
    if (wanted && playing && !lock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } else if ((!wanted || !playing) && lock) {
      await lock.release();
      lock = null;
    }
  } catch { lock = null; }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wanted) sync(true); });
}
