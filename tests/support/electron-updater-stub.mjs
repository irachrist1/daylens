// electron-updater is a CommonJS module whose `{ autoUpdater }` named export the
// raw ESM ts-loader can't bind (vite handles the interop in real builds). The
// updater service is pulled into the main-process module graph via
// debug.handlers, so importing any handler module under the hermetic loader
// would throw without this. The auto-updater never runs in tests, but the
// stub records listeners and calls so the updater state-machine tests can
// emit electron-updater lifecycle events (update-available, download-progress,
// update-downloaded, error) and assert how the service reacts.
const listeners = new Map()

export const updaterRecord = {
  checkForUpdatesCalls: 0,
  quitAndInstallCalls: 0,
  emit(event, ...args) {
    for (const fn of listeners.get(event) ?? []) fn(...args)
  },
  listenerCount(event) {
    return (listeners.get(event) ?? []).length
  },
  reset() {
    listeners.clear()
    this.checkForUpdatesCalls = 0
    this.quitAndInstallCalls = 0
  },
}

export const autoUpdater = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  on(event, fn) {
    const list = listeners.get(event) ?? []
    list.push(fn)
    listeners.set(event, list)
    return this
  },
  once(event, fn) {
    return this.on(event, fn)
  },
  removeAllListeners(event) {
    if (event) listeners.delete(event)
    else listeners.clear()
    return this
  },
  setFeedURL() {},
  async checkForUpdates() {
    updaterRecord.checkForUpdatesCalls += 1
    return null
  },
  async checkForUpdatesAndNotify() {
    return null
  },
  async downloadUpdate() {
    return []
  },
  quitAndInstall() {
    updaterRecord.quitAndInstallCalls += 1
  },
  get currentVersion() {
    return { version: '0.0.0-test' }
  },
}

export default { autoUpdater }
