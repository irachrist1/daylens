// electron-updater is a CommonJS module whose `{ autoUpdater }` named export the
// raw ESM ts-loader can't bind (vite handles the interop in real builds). The
// updater service is pulled into the main-process module graph via
// debug.handlers, so importing any handler module under the hermetic loader
// would throw without this. The auto-updater never runs in tests; a no-op stub
// is all the graph needs to resolve.
export const autoUpdater = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  on() {},
  once() {},
  removeAllListeners() {},
  setFeedURL() {},
  async checkForUpdates() {
    return null
  },
  async checkForUpdatesAndNotify() {
    return null
  },
  async downloadUpdate() {
    return []
  },
  quitAndInstall() {},
  get currentVersion() {
    return { version: '0.0.0-test' }
  },
}

export default { autoUpdater }
