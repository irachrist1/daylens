import os from 'node:os'

let userDataOverride = null

export const app = {
  isPackaged: false,
  getPath(name) {
    if (name === 'userData') return userDataOverride ?? os.tmpdir()
    return os.tmpdir()
  },
  setPath(name, value) {
    if (name === 'userData') userDataOverride = value
  },
  getAppPath() {
    // Tests that exercise path resolution (e.g. mcpServer) can point this at a
    // fixture root via DAYLENS_TEST_APP_PATH; otherwise it's a harmless tmp dir.
    return process.env.DAYLENS_TEST_APP_PATH || os.tmpdir()
  },
  getVersion() {
    return '0.0.0-test'
  },
  async getFileIcon() {
    return {
      isEmpty() {
        return true
      },
      toDataURL() {
        return ''
      },
    }
  },
}

export const nativeImage = {
  createFromPath() {
    return {
      isEmpty() {
        return true
      },
      toDataURL() {
        return ''
      },
    }
  },
}

export const BrowserWindow = {
  getAllWindows() {
    return []
  },
}

export const dialog = {
  async showSaveDialog() {
    return { canceled: true, filePath: null }
  },
}

export const shell = {
  async openPath() {
    return ''
  },
}

export class Notification {
  static isSupported() { return true }
  on(event, fn) {
    if (!this._events) this._events = {}
    if (!this._events[event]) this._events[event] = []
    this._events[event].push(fn)
  }
  show() {
    // Async emit show so the caller can register listeners first
    Promise.resolve().then(() => {
      for (const fn of (this._events?.show ?? [])) fn()
    })
  }
}

export const powerMonitor = {
  on() {},
  removeListener() {},
}

export const systemPreferences = {
  getMediaAccessStatus() {
    return 'not-determined'
  },
  askForMediaAccess() {
    return Promise.resolve(false)
  },
}

export const Menu = {
  buildFromTemplate() {
    return { popup() {}, append() {} }
  },
  setApplicationMenu() {},
}

export class Tray {
  setToolTip() {}
  setContextMenu() {}
  on() {}
  destroy() {}
}

export const globalShortcut = {
  register() {
    return true
  },
  unregister() {},
  unregisterAll() {},
}

export const net = {
  request() {
    throw new Error('electron-stub: net.request is not available in hermetic tests')
  },
}

// Recording IPC layer. The loader maps `electron` to this file, so the main
// process (ipcMain.handle in *.handlers.ts) and the renderer bridge
// (ipcRenderer.invoke / contextBridge in preload) both wire through these
// stubs and into the same `ipcRecord`. The IPC-contract test reads `ipcRecord`
// to verify every channel the renderer invokes has a registered handler.
export const ipcRecord = {
  handlers: new Map(), // channel -> handler fn registered via ipcMain.handle
  events: new Map(), // channel -> handler fns registered via ipcMain.on
  invoked: [], // channels the renderer called via ipcRenderer.invoke
  sent: [], // channels the renderer called via ipcRenderer.send
  exposed: {}, // key -> api object passed to contextBridge.exposeInMainWorld
  reset() {
    this.handlers.clear()
    this.events.clear()
    this.invoked = []
    this.sent = []
    this.exposed = {}
  },
}

export const ipcMain = {
  handle(channel, fn) {
    ipcRecord.handlers.set(channel, fn)
  },
  handleOnce(channel, fn) {
    ipcRecord.handlers.set(channel, fn)
  },
  on(channel, fn) {
    const list = ipcRecord.events.get(channel) ?? []
    list.push(fn)
    ipcRecord.events.set(channel, list)
  },
  removeHandler(channel) {
    ipcRecord.handlers.delete(channel)
  },
  removeAllListeners() {},
}

export const ipcRenderer = {
  invoke(channel) {
    ipcRecord.invoked.push(channel)
    return Promise.resolve(undefined)
  },
  send(channel) {
    ipcRecord.sent.push(channel)
  },
  on() {},
  removeListener() {},
}

export const contextBridge = {
  exposeInMainWorld(key, api) {
    ipcRecord.exposed[key] = api
  },
}
