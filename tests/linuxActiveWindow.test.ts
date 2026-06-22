// Linux active-window capture simulation (gemini F8 area). The Linux fallback
// resolver (hyprctl / swaymsg / xdotool+xprop) cannot run on the macOS dev box,
// so we drive it with canned window-manager output through a test seam and
// assert it resolves the right app identity. This confirms the Linux capture
// parsing works without a Linux host.
import test from 'node:test'
import assert from 'node:assert/strict'
import { linuxFallbackActiveWindow, __setLinuxCaptureTestHarness } from '../src/main/services/tracking.ts'

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {}
  for (const key of Object.keys(vars)) saved[key] = process.env[key]
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fn()
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('resolves the focused window from canned hyprctl output', () => {
  __setLinuxCaptureTestHarness({
    availableCommands: ['hyprctl'],
    exec: (command, args) => {
      if (command === 'hyprctl' && args.join(' ') === 'activewindow -j') {
        return JSON.stringify({ class: 'firefox', initialClass: 'firefox', title: 'GitHub - Mozilla Firefox', pid: 4321 })
      }
      return null
    },
  })
  try {
    withEnv({ HYPRLAND_INSTANCE_SIGNATURE: 'sim', SWAYSOCK: undefined, DISPLAY: undefined }, () => {
      const result = linuxFallbackActiveWindow()
      assert.ok(result?.win, 'expected a resolved window from hyprctl')
      assert.equal(result.source, 'hyprctl')
      assert.equal(result.win.application, 'firefox')
      assert.equal(result.win.title, 'GitHub - Mozilla Firefox')
      assert.equal(result.win.pid, 4321)
    })
  } finally {
    __setLinuxCaptureTestHarness(null)
  }
})

test('resolves the focused window from canned xdotool + xprop output (X11)', () => {
  const windowId = '0x3c00007'
  __setLinuxCaptureTestHarness({
    availableCommands: ['xdotool', 'xprop'],
    exec: (command, args) => {
      if (command === 'xdotool' && args[0] === 'getactivewindow') return windowId
      if (command === 'xdotool' && args[0] === 'getwindowname') return 'Inbox - Mail'
      if (command === 'xdotool' && args[0] === 'getwindowpid') return '987'
      if (command === 'xprop' && args[0] === '-id') {
        return [
          '_NET_WM_PID(CARDINAL) = 987',
          'WM_CLASS(STRING) = "Navigator", "Thunderbird"',
          '_NET_WM_NAME(UTF8_STRING) = "Inbox - Mail"',
        ].join('\n')
      }
      return null
    },
  })
  try {
    withEnv({ HYPRLAND_INSTANCE_SIGNATURE: undefined, SWAYSOCK: undefined, DISPLAY: ':0' }, () => {
      const result = linuxFallbackActiveWindow()
      assert.ok(result?.win, 'expected a resolved window from xdotool/xprop')
      assert.equal(result.source, 'xdotool')
      assert.equal(result.win.title, 'Inbox - Mail')
      assert.equal(result.win.application, 'Thunderbird', 'falls back to the WM_CLASS instance token')
      assert.equal(result.win.pid, 987)
    })
  } finally {
    __setLinuxCaptureTestHarness(null)
  }
})

test('reports a not-found trace when the session has no usable helper', () => {
  __setLinuxCaptureTestHarness({ availableCommands: [], exec: () => null })
  try {
    withEnv({ HYPRLAND_INSTANCE_SIGNATURE: undefined, SWAYSOCK: undefined, DISPLAY: ':0' }, () => {
      const result = linuxFallbackActiveWindow()
      assert.equal(result?.win, null, 'no window resolved when no helper command is available')
      assert.ok((result?.trace.length ?? 0) > 0, 'a diagnostic trace is recorded')
    })
  } finally {
    __setLinuxCaptureTestHarness(null)
  }
})

test('resolves focused window from canned gdbus GNOME Shell output', () => {
  __setLinuxCaptureTestHarness({
    availableCommands: ['gdbus'],
    exec: (command, args) => {
      if (command === 'gdbus' && args.includes('org.gnome.Shell.Eval')) {
        return "(true, 'GitHub - Google Chrome')"
      }
      return null
    },
  })
  try {
    withEnv({
      HYPRLAND_INSTANCE_SIGNATURE: undefined,
      SWAYSOCK: undefined,
      DISPLAY: undefined,
      XDG_SESSION_TYPE: 'wayland',
      XDG_CURRENT_DESKTOP: 'GNOME',
    }, () => {
      const result = linuxFallbackActiveWindow()
      assert.ok(result?.win, 'expected GNOME Shell focused title')
      assert.equal(result.win.title, 'GitHub - Google Chrome')
      assert.equal(result.win.application, 'Google Chrome')
    })
  } finally {
    __setLinuxCaptureTestHarness(null)
  }
})
