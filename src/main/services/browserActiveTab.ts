import { execFileSync } from 'node:child_process'

export interface ActiveBrowserTabContext {
  browserBundleId: string
  url: string
  pageTitle: string | null
}

function normalizeLine(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function isSupportedBrowser(bundleId: string, appName: string): boolean {
  const combined = `${bundleId} ${appName}`.toLowerCase()
  return combined.includes('safari')
}

function safariContext(): ActiveBrowserTabContext | null {
  const script = [
    'tell application "Safari"',
    '  if it is running then',
    '    try',
    '      set pageTitle to name of current tab of front window',
    '      set pageURL to URL of current tab of front window',
    '      return pageTitle & linefeed & pageURL',
    '    on error',
    '      return ""',
    '    end try',
    '  end if',
    'end tell',
  ]

  try {
    const output = execFileSync('osascript', script.flatMap((line) => ['-e', line]), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1_500,
    }).trim()

    if (!output) return null
    const [rawTitle, rawUrl] = output.split(/\r?\n/, 2)
    const url = normalizeLine(rawUrl)
    if (!/^https?:\/\//i.test(url)) return null

    return {
      browserBundleId: 'com.apple.Safari',
      pageTitle: normalizeLine(rawTitle) || null,
      url,
    }
  } catch {
    return null
  }
}

export function getActiveBrowserTabContext(bundleId: string, appName: string): ActiveBrowserTabContext | null {
  if (process.platform !== 'darwin') return null
  if (!isSupportedBrowser(bundleId, appName)) return null

  const combined = `${bundleId} ${appName}`.toLowerCase()
  if (combined.includes('safari')) {
    return safariContext()
  }

  return null
}
