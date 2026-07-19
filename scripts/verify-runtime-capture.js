const fs = require('node:fs')
const path = require('node:path')

function verifyRuntimeCapture(report, statePathArg, fail) {
  if (!statePathArg) {
    fail('The runtime window-state report path is required.')
  }

  const statePath = path.resolve(statePathArg)
  if (!fs.existsSync(statePath)) {
    fail(`Runtime window-state report does not exist: ${statePath}`)
  }

  const windowState = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  if (
    windowState.foreground?.activated !== true ||
    typeof windowState.foreground.title !== 'string'
  ) {
    fail('The foreground probe window was not activated successfully.')
  }
  if (
    windowState.fullscreen?.activated !== true ||
    windowState.fullscreen?.fullscreen !== true ||
    typeof windowState.fullscreen.title !== 'string'
  ) {
    fail('The fullscreen probe window did not enter fullscreen successfully.')
  }

  const captureProbe = report.captureProbe
  if (!captureProbe || captureProbe.required !== true || !Array.isArray(captureProbe.sessions)) {
    fail('The packaged app did not run the required foreground/fullscreen capture probe.')
  }
  if (captureProbe.foregroundTitle !== windowState.foreground.title) {
    fail(
      `Foreground title mismatch: expected ${windowState.foreground.title}, got ${captureProbe.foregroundTitle}`,
    )
  }
  if (captureProbe.fullscreenTitle !== windowState.fullscreen.title) {
    fail(
      `Fullscreen title mismatch: expected ${windowState.fullscreen.title}, got ${captureProbe.fullscreenTitle}`,
    )
  }

  for (const [kind, title] of [
    ['foreground', windowState.foreground.title],
    ['fullscreen', windowState.fullscreen.title],
  ]) {
    const session = captureProbe.sessions.find((candidate) => candidate.windowTitle === title)
    if (!session) {
      fail(`No persisted app session captured the ${kind} probe title ${JSON.stringify(title)}.`)
    }
    if (!Number.isFinite(session.durationSec) || session.durationSec < 10) {
      fail(
        `The ${kind} probe session was shorter than the 10-second persistence floor: ${session.durationSec}`,
      )
    }
    if (typeof session.captureSource !== 'string' || session.captureSource.length === 0) {
      fail(`The ${kind} probe session did not preserve its capture source.`)
    }
  }

  // Canonical evidence contract: every desktop platform mirrors foreground
  // observations into focus_events, so each probe title must also appear as a
  // canonical activation — a legacy-only capture is a silent regression.
  if (!Array.isArray(captureProbe.canonicalEvents)) {
    fail('The capture probe did not report canonical focus events.')
  }
  for (const [kind, title] of [
    ['foreground', windowState.foreground.title],
    ['fullscreen', windowState.fullscreen.title],
  ]) {
    const activation = captureProbe.canonicalEvents.find(
      (candidate) =>
        candidate.windowTitle === title
        && (candidate.eventType === 'app_activated' || candidate.eventType === 'window_changed'),
    )
    if (!activation) {
      fail(
        `No canonical focus event captured the ${kind} probe title ${JSON.stringify(title)}. `
        + `Canonical events: ${JSON.stringify(captureProbe.canonicalEvents)}`,
      )
    }
    if (activation.platform !== report.platform) {
      fail(
        `The ${kind} canonical activation recorded platform ${JSON.stringify(activation.platform)} `
        + `but the app ran on ${JSON.stringify(report.platform)}.`,
      )
    }
  }

  return {
    foregroundTitle: windowState.foreground.title,
    fullscreenTitle: windowState.fullscreen.title,
    capturedSessions: captureProbe.sessions.length,
    canonicalEvents: captureProbe.canonicalEvents.length,
  }
}

module.exports = { verifyRuntimeCapture }
