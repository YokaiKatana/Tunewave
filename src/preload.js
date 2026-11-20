const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tunewave', {
  platform: process.platform,
  setTitlebarColors: (color, symbolColor) => ipcRenderer.send('titlebar-colors', { color, symbolColor }),
  nowPlaying: (np) => ipcRenderer.send('now-playing', np),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  artworkColor: (url) => ipcRenderer.invoke('artwork-color', url),
  clearSession: () => ipcRenderer.invoke('clear-session'),
  openSignIn: (url) => ipcRenderer.send('open-signin', url),
  onSignedIn: (fn) => ipcRenderer.on('signed-in', () => fn()),
  onShortcut: (fn) => ipcRenderer.on('shortcut', (_e, name) => fn(name)),
  onPlayerCommand: (fn) => ipcRenderer.on('player-command', (_e, cmd) => fn(cmd)),
});
