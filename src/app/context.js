// コンポーネント間で共有するシングルトン（再生エンジンなど）
export const ctx = {
  engine: null,
  isTouch: typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0),
  isMac: typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || ''),
  isElectron: typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent || '')
};

export function modKey() { return ctx.isMac ? '⌘' : 'Ctrl'; }
