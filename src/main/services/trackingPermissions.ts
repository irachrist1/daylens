import { shell, systemPreferences } from 'electron'
import { ANALYTICS_EVENT, classifyFailureKind } from '@shared/analytics'
import type {
  CapturePermissionStatus,
  TrackingPermissionDetails,
  TrackingPermissionState,
} from '@shared/types'
import { capture, captureException } from './analytics'
import { getSettings, setSettings } from './settings'
import { requestTrackingPermission, getLinuxTrackingDiagnostics } from './tracking'
import { isWindowsFocusCaptureRunning } from './windowsFocusCapture'

const MAC_SCREEN_RECORDING_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
const MAC_ACCESSIBILITY_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'

function normalizeMacScreenPermissionStatus(status: string): CapturePermissionStatus {
  switch (status) {
    case 'granted':
      return 'granted'
    case 'denied':
    case 'restricted':
    case 'not-determined':
      return 'missing'
    default:
      return 'unsupported_or_unknown'
  }
}

export function getTrackingPermissionDetails(): TrackingPermissionDetails {
  if (process.platform === 'win32') {
    const helperRunning = isWindowsFocusCaptureRunning()
    return {
      accessibility: 'unsupported_or_unknown',
      screenRecording: 'unsupported_or_unknown',
      combined: helperRunning ? 'granted' : 'missing',
      platformNote: 'Windows does not use macOS Accessibility. Daylens relies on its capture helper and foreground polling.',
      captureHelperRunning: helperRunning,
    }
  }

  if (process.platform === 'linux') {
    const linuxTracking = getLinuxTrackingDiagnostics()
    const supportLevel = linuxTracking?.supportLevel ?? 'limited'
    const combined: TrackingPermissionState =
      supportLevel === 'ready'
        ? 'granted'
        : supportLevel === 'limited'
          ? 'missing'
          : 'missing'
    return {
      accessibility: 'unsupported_or_unknown',
      screenRecording: 'unsupported_or_unknown',
      combined,
      platformNote: linuxTracking?.supportMessage
        ?? 'Linux capture depends on your desktop session. Open Capture health in Settings for details.',
    }
  }

  if (process.platform !== 'darwin') {
    return {
      accessibility: 'granted',
      screenRecording: 'granted',
      combined: 'granted',
    }
  }

  let accessibility: CapturePermissionStatus = 'unsupported_or_unknown'
  let screenRecording: CapturePermissionStatus = 'unsupported_or_unknown'
  try {
    accessibility = systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'missing'
  } catch (err) {
    console.warn('[tracking-permissions] failed to read accessibility permission state:', err)
  }
  try {
    screenRecording = normalizeMacScreenPermissionStatus(systemPreferences.getMediaAccessStatus('screen'))
  } catch (err) {
    console.warn('[tracking-permissions] failed to read screen permission state:', err)
  }

  const combined: TrackingPermissionState =
    accessibility === 'granted' && screenRecording === 'granted'
      ? 'granted'
      : accessibility === 'missing' || screenRecording === 'missing'
        ? 'missing'
        : 'unsupported_or_unknown'
  return { accessibility, screenRecording, combined }
}

export function getTrackingPermissionState(): TrackingPermissionState {
  return getTrackingPermissionDetails().combined
}

async function openTrackingPermissionSettings(
  permission: 'accessibility' | 'screenRecording' = 'screenRecording',
): Promise<void> {
  if (process.platform !== 'darwin') return
  try {
    await shell.openExternal(
      permission === 'accessibility'
        ? MAC_ACCESSIBILITY_SETTINGS_URL
        : MAC_SCREEN_RECORDING_SETTINGS_URL,
    )
  } catch (err) {
    console.warn('[tracking-permissions] failed to open System Settings:', err)
    capture(ANALYTICS_EVENT.TRACKING_PERMISSION_UPDATED, {
      failure_kind: classifyFailureKind(err),
      permission_state: 'unsupported_or_unknown',
      result: 'error',
      surface: 'onboarding',
      trigger: 'request',
    })
  }
}

export async function requestScreenTrackingPermission(): Promise<TrackingPermissionState> {
  if (process.platform !== 'darwin') return 'granted'

  try {
    const accessibilityGranted = systemPreferences.isTrustedAccessibilityClient(true)
    const screenGranted = requestTrackingPermission()
    const details = getTrackingPermissionDetails()
    const granted = accessibilityGranted
      && screenGranted !== false
      && details.accessibility === 'granted'
      && details.screenRecording === 'granted'
    const permissionRequestedAt = Date.now()
    const nextState: TrackingPermissionState = granted ? 'awaiting_relaunch' : 'missing'
    await setSettings({
      onboardingState: {
        ...getSettings().onboardingState,
        trackingPermissionState: nextState,
        permissionRequestedAt,
        stage: granted ? 'relaunch_required' : 'permission',
      },
    })

    capture(ANALYTICS_EVENT.TRACKING_PERMISSION_UPDATED, {
      permission_state: nextState,
      result: granted ? 'success' : 'blocked',
      surface: 'onboarding',
      trigger: 'request',
    })

    if (!granted) {
      await openTrackingPermissionSettings(
        details.accessibility !== 'granted' ? 'accessibility' : 'screenRecording',
      )
    }

    return nextState
  } catch (error) {
    capture(ANALYTICS_EVENT.TRACKING_PERMISSION_UPDATED, {
      failure_kind: classifyFailureKind(error),
      permission_state: 'unsupported_or_unknown',
      result: 'error',
      surface: 'onboarding',
      trigger: 'request',
    })
    captureException(error, {
      tags: {
        process_type: 'main',
        reason: 'tracking_permission_request_failed',
      },
    })
    throw error
  }
}
