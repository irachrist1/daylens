import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createDefaultOnboardingState } from '../src/main/lib/onboardingState.ts'

const onboardingSource = fs.readFileSync(
  new URL('../src/renderer/views/Onboarding.tsx', import.meta.url),
  'utf8',
)
const reconcileSource = fs.readFileSync(
  new URL('../src/main/services/onboarding.ts', import.meta.url),
  'utf8',
)

test('onboarding flow orders capture explainer, permission, proof, then privacy', () => {
  assert.match(
    onboardingSource,
    /const STAGE_FLOW: OnboardingStage\[\] = \[[\s\S]*?'why', 'permission', 'proof', 'privacy'/,
  )
  assert.match(onboardingSource, /Capture is on from the start/)
  assert.match(onboardingSource, /What Daylens captures/)
  assert.match(onboardingSource, /What it never captures/)
  assert.match(onboardingSource, /PROOF_TIMEOUT_MS/)
  assert.match(onboardingSource, /Nothing captured yet/)
  assert.doesNotMatch(onboardingSource, /WHY_BEATS/)
})

test('every platform walks a permission step before proof', () => {
  assert.match(onboardingSource, /Checking the capture helper/)
  assert.match(onboardingSource, /How much this desktop can share/)
  assert.match(onboardingSource, /async function consentAndLeaveWhy\(\)[\s\S]*?persistOnboarding\('permission'/)
  assert.doesNotMatch(
    onboardingSource,
    /persistOnboarding\(isMac \? 'permission' : 'proof'/,
  )
})

test('proof continue goes to privacy and exclusions persist immediately', () => {
  assert.match(
    onboardingSource,
    /async function continueFromProof\(\)[\s\S]*?persistOnboarding\('privacy'/,
  )
  assert.match(onboardingSource, /async function persistExclusions\(/)
  assert.match(onboardingSource, /trackingExcludedSites/)
  assert.match(onboardingSource, /Suggested from activity Daylens can already see/)
  assert.match(onboardingSource, /const privatePool = visibleActivity/)
  assert.doesNotMatch(
    onboardingSource,
    /privatePool = Array\.from\(new Set\(\[[\s\S]*?POPULAR_APPS_AND_SITES/,
  )
})

test('skipping setup never declines capture — it only shortcuts the flow', () => {
  assert.match(
    onboardingSource,
    /async function skipWhy\(\)[\s\S]*?persistOnboarding\('tour', \{ proofState: 'idle' \}\)/,
  )
  const skipWhy = onboardingSource.split('async function skipWhy()')[1]?.split('async function continueFromProof')[0] ?? ''
  assert.ok(!skipWhy.includes('setCaptureConsent'))
})

test('non-mac reconcile syncs helper or session support instead of forcing granted', () => {
  assert.match(reconcileSource, /process\.platform !== 'darwin'/)
  assert.match(reconcileSource, /getTrackingPermissionState\(\)/)
  assert.doesNotMatch(
    reconcileSource,
    /trackingPermissionState = 'granted'/,
  )
})

test('fresh onboarding starts permission state unverified on every platform', () => {
  const state = createDefaultOnboardingState(false)
  assert.equal(state.trackingPermissionState, 'missing')
  assert.equal(state.stage, 'welcome')
})
