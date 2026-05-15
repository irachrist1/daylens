// Minimal electron stub for the behavioural harness. Identical to the
// hermetic electron-stub.mjs in shape, but app.getPath('userData') is
// monkey-patchable from outside via DAYLENS_HARNESS_USERDATA env var, and
// shell.openPath / dialog do real things.
//
// The harness uses ELECTRON_RUN_AS_NODE so `import 'electron'` fails without
// a stub. The real Electron app machinery isn't running; we only need the
// surface the AI pipeline touches.

import os from 'node:os'
import { spawn } from 'node:child_process'

let userDataOverride = process.env.DAYLENS_HARNESS_USERDATA ?? null

export const app = {
  isPackaged: false,
  getPath(name) {
    if (name === 'userData') {
      return userDataOverride ?? os.tmpdir()
    }
    if (name === 'home') return os.homedir()
    if (name === 'temp') return os.tmpdir()
    return os.tmpdir()
  },
  setPath(name, value) {
    if (name === 'userData') {
      userDataOverride = value
    }
  },
  getVersion() {
    return '0.0.0-behaviour'
  },
  on() {},
  off() {},
  removeListener() {},
  whenReady() {
    return Promise.resolve()
  },
  async getFileIcon() {
    return {
      isEmpty() { return true },
      toDataURL() { return '' },
    }
  },
}

export const nativeImage = {
  createFromPath() {
    return { isEmpty() { return true }, toDataURL() { return '' } }
  },
}

export const BrowserWindow = {
  getAllWindows() { return [] },
}

export const dialog = {
  async showSaveDialog() {
    // Harness never actually exports a file via dialog — it inspects the
    // artifact record directly. Returning canceled is the safe default.
    return { canceled: true, filePath: null }
  },
  async showOpenDialog() {
    return { canceled: true, filePaths: [] }
  },
}

export const shell = {
  openPath(target) {
    return new Promise((resolve) => {
      const child = spawn('open', [target], { stdio: 'ignore', detached: true })
      child.on('error', (e) => resolve(String(e)))
      child.on('exit', () => resolve(''))
      child.unref()
    })
  },
}

export class Notification {
  show() {}
}

export const powerMonitor = {
  on() {},
  off() {},
  removeListener() {},
}

export const ipcMain = {
  handle() {},
  on() {},
  removeHandler() {},
  removeAllListeners() {},
}

export const Menu = {
  buildFromTemplate() { return { popup() {} } },
  setApplicationMenu() {},
}

export const Tray = class {}
export const safeStorage = {
  isEncryptionAvailable() { return false },
  encryptString(s) { return Buffer.from(s, 'utf8') },
  decryptString(b) { return b.toString('utf8') },
}
export const screen = {
  getPrimaryDisplay() { return { workArea: { x: 0, y: 0, width: 1920, height: 1080 } } },
}
export default {
  app, nativeImage, BrowserWindow, dialog, shell, Notification, powerMonitor,
  ipcMain, Menu, Tray, safeStorage, screen,
}
