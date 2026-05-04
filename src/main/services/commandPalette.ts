import { BrowserWindow, globalShortcut } from 'electron'

export const PALETTE_TOGGLE_CHANNEL = 'palette:toggle'

const MAC_ACCELERATOR = 'CommandOrControl+Alt+D'
const WIN_LINUX_ACCELERATOR = 'CommandOrControl+Alt+D'

let registeredAccelerator: string | null = null
let providedWindow: (() => BrowserWindow | null) | null = null

function paletteAccelerator(): string {
  return process.platform === 'darwin' ? MAC_ACCELERATOR : WIN_LINUX_ACCELERATOR
}

function fireToggle(): void {
  const win = providedWindow?.() ?? null
  if (!win || win.isDestroyed()) return

  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()

  win.webContents.send(PALETTE_TOGGLE_CHANNEL)
}

export function registerCommandPaletteShortcut(getWindow: () => BrowserWindow | null): void {
  providedWindow = getWindow
  unregisterCommandPaletteShortcut()
  const accelerator = paletteAccelerator()

  const ok = globalShortcut.register(accelerator, fireToggle)
  if (ok) {
    registeredAccelerator = accelerator
    console.log('[palette] global shortcut registered:', accelerator)
  } else {
    console.warn('[palette] failed to register global shortcut:', accelerator)
  }
}

export function unregisterCommandPaletteShortcut(): void {
  if (registeredAccelerator) {
    try { globalShortcut.unregister(registeredAccelerator) } catch { /* noop */ }
    registeredAccelerator = null
  }
}

export function commandPaletteAccelerator(): string {
  return paletteAccelerator()
}
