import type { AppSettings, OnboardingStage, ProofState } from '@shared/types'
import { nextMacStageAfterGrantedPermission } from '@shared/onboarding'
import { grantedCaptureConsent, isCaptureConsentCurrent, type CaptureConsentState } from '@shared/captureConsent'
import { getTrackingPermissionState } from './trackingPermissions'
import { getSettingsAsync, setSettings } from './settings'

function nextProofState(stage: OnboardingStage, current: ProofState): ProofState {
  if (stage === 'complete') return 'ready'
  if (stage === 'proof') return current === 'ready' ? 'ready' : 'collecting'
  return current
}

export async function reconcileOnboardingState(): Promise<AppSettings> {
  const settings = await getSettingsAsync()
  let changed = false
  const onboardingState = { ...settings.onboardingState }

  // Installing is consent: capture is on from first launch, so 'unset' and
  // stale-policy grants both reconcile to granted at the current policy
  // version. Only an explicit decline (legacy installs; recoverable in
  // Settings) is preserved.
  let captureConsent: CaptureConsentState = settings.captureConsent
  if (captureConsent.status !== 'declined' && !isCaptureConsentCurrent(captureConsent)) {
    captureConsent = grantedCaptureConsent(Date.now())
    changed = true
  }

  if (settings.onboardingComplete && onboardingState.stage !== 'complete') {
    onboardingState.stage = 'complete'
    onboardingState.completedAt = onboardingState.completedAt ?? Date.now()
    onboardingState.proofState = 'ready'
    onboardingState.personalizationState = 'completed'
    changed = true
  }

  if (process.platform === 'darwin' && onboardingState.stage !== 'complete') {
    const permissionState = getTrackingPermissionState()
    if (onboardingState.trackingPermissionState !== permissionState) {
      onboardingState.trackingPermissionState = permissionState
      changed = true
    }

    if (permissionState === 'granted') {
      const nextStage = nextMacStageAfterGrantedPermission({
        currentStage: onboardingState.stage,
        permissionRequestedAt: onboardingState.permissionRequestedAt,
        origin: 'startup',
      })

      if (nextStage && onboardingState.stage !== nextStage) {
        onboardingState.stage = nextStage
        changed = true
      }
    }

    if (permissionState !== 'granted' && onboardingState.stage !== 'welcome' && onboardingState.stage !== 'permission') {
      onboardingState.stage = 'permission'
      onboardingState.proofState = 'idle'
      changed = true
    }
  } else if (process.platform !== 'darwin' && onboardingState.stage !== 'complete') {
    const permissionState = getTrackingPermissionState()
    if (onboardingState.trackingPermissionState !== permissionState) {
      onboardingState.trackingPermissionState = permissionState
      changed = true
    }
    if (permissionState === 'granted' && onboardingState.stage === 'permission') {
      onboardingState.stage = 'proof'
      changed = true
    }
  }

  onboardingState.proofState = nextProofState(onboardingState.stage, onboardingState.proofState)

  if (changed) {
    await setSettings({
      onboardingState,
      onboardingComplete: onboardingState.stage === 'complete',
      captureConsent,
    })
  }

  return changed
    ? { ...settings, onboardingState, onboardingComplete: onboardingState.stage === 'complete', captureConsent }
    : settings
}
