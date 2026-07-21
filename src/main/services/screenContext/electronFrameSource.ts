// Screen-context experiment (DEV-198) — the production frame source.
//
// One adapter serves both supported platforms through Electron's
// desktopCapturer, which sits on ScreenCaptureKit on modern macOS and
// Windows.Graphics.Capture on Windows — the exact OS APIs the specification
// names. It reads a single still of ONE display (the active one) per call;
// it never opens a stream, never records video, never touches audio.
//
// Refusals are honest nulls, decided BEFORE pixels:
//   - macOS Screen Recording permission not granted → null (the experiment
//     owns that permission; nothing here prompts for it);
//   - the requested display is gone → null;
//   - an empty thumbnail (protected content blanked by the OS) → null.
//
// Frame size is bounded: long edge capped at 1600px — enough for local OCR,
// small enough to keep the encrypted backlog inside its byte cap.
import { desktopCapturer, screen, systemPreferences } from 'electron'
import type { ScreenFrameSource } from './sampler'

const MAX_LONG_EDGE_PX = 1600

export function screenRecordingPermissionGranted(): boolean {
  if (process.platform !== 'darwin') return true
  try {
    return systemPreferences.getMediaAccessStatus('screen') === 'granted'
  } catch {
    return false
  }
}

/** The display frames should come from: the one the pointer is on — the
 *  spec's "active display" — unless the caller pinned one. */
function resolveTargetDisplay(displayId: number | null): Electron.Display | null {
  try {
    if (displayId != null) {
      return screen.getAllDisplays().find((display) => display.id === displayId) ?? null
    }
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  } catch {
    return null
  }
}

export function createElectronScreenFrameSource(): ScreenFrameSource {
  return {
    kind: process.platform === 'darwin' ? 'macos-screencapturekit' : 'windows-graphics-capture',

    async capture(displayId: number | null): Promise<Uint8Array | null> {
      if (!screenRecordingPermissionGranted()) return null
      const display = resolveTargetDisplay(displayId)
      if (!display) return null

      const { width, height } = display.size
      const scale = Math.min(1, MAX_LONG_EDGE_PX / Math.max(width, height, 1))
      let sources: Electron.DesktopCapturerSource[]
      try {
        sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: {
            width: Math.max(1, Math.round(width * scale)),
            height: Math.max(1, Math.round(height * scale)),
          },
        })
      } catch {
        return null
      }
      const match = sources.find((source) => source.display_id === String(display.id)) ?? sources[0]
      if (!match || match.thumbnail.isEmpty()) return null
      const png = match.thumbnail.toPNG()
      return png.byteLength > 0 ? new Uint8Array(png) : null
    },
  }
}
