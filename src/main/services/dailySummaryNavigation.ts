import { app, BrowserWindow } from 'electron'
import type { AIDailyReportPreparationResult } from '@shared/types'

type NavigationWindow = Pick<BrowserWindow, 'isDestroyed' | 'isMinimized' | 'isVisible' | 'restore' | 'show' | 'focus' | 'webContents'>

let navigationWindow: BrowserWindow | null = null

// Holds the most recent route requested via openDailySummaryRoute that the
// renderer may not have received (e.g. listener wasn't mounted yet). Renderer
// drains this through IPC once it subscribes.
let pendingRoute: string | null = null

export function consumePendingNavigationRoute(): string | null {
  const route = pendingRoute
  pendingRoute = null
  return route
}

export function setDailySummaryNavigationWindow(window: BrowserWindow | null): void {
  navigationWindow = window
}

function currentNavigationWindow(): BrowserWindow | null {
  if (navigationWindow && !navigationWindow.isDestroyed()) return navigationWindow
  const current = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null
  navigationWindow = current
  return current
}

export function openDailySummaryRoute(
  route: string,
  getWindow: () => NavigationWindow | null = currentNavigationWindow,
): boolean {
  pendingRoute = route

  const window = getWindow()
  if (!window || window.isDestroyed()) return false

  // On macOS the dock icon goes dim and `window.show()` alone doesn't always
  // bring the app forward when Daylens is hidden in tray. Ask Electron to
  // bring the app to the foreground first so the click-through is reliable.
  if (process.platform === 'darwin') {
    try { app.focus({ steal: true }) } catch { /* best effort */ }
  }

  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()

  // Renderer also pulls `pendingRoute` via IPC on mount, so the send below is
  // best-effort. Listener may not yet be attached when the event fires.
  if (window.webContents.isLoadingMainFrame()) {
    window.webContents.once('did-finish-load', () => {
      if (window.isDestroyed()) return
      window.webContents.send('navigate', route)
    })
  } else {
    window.webContents.send('navigate', route)
  }

  return true
}

export function buildDailyReportRoute(report: Pick<AIDailyReportPreparationResult, 'date' | 'threadId' | 'artifactId'>): string {
  const params = new URLSearchParams()
  if (report.threadId != null) params.set('threadId', String(report.threadId))
  if (report.artifactId != null) params.set('artifactId', String(report.artifactId))
  params.set('date', report.date)
  params.set('source', 'daily-summary')
  const query = params.toString()
  return query ? `/ai?${query}` : '/ai'
}
