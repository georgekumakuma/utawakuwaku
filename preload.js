// Electron プリロード（contextIsolation 有効）。
// レンダラーには Node を公開せず、環境の識別だけを渡す。
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('utawakuwakuDesktop', {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome }
});
