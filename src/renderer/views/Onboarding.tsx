import { useEffect, useMemo, useRef, useState } from 'react'
import { ANALYTICS_EVENT, blockCountBucket, trackedTimeBucket } from '@shared/analytics'
import type {
  AppSettings,
  DayTimelinePayload,
  LiveSession,
  OnboardingStage,
  ProofState,
  TrackingPermissionDetails,
  TrackingPermissionState,
  LinuxTrackingDiagnostics,
} from '@shared/types'
import { nextMacStageAfterGrantedPermission } from '@shared/onboarding'
import { ipc } from '../lib/ipc'
import { track } from '../lib/analytics'
import { todayString } from '../lib/format'
import ConnectAI from '../components/ConnectAI'

// Intent chips double as goal ids (persisted to userGoals for back-compat) and as
// sentences that auto-fill the free-text intent box (persisted to userIntent).
const INTENTS = [
  { id: 'billable', label: 'Track billable work', phrase: 'Track billable work across clients and projects.' },
  { id: 'time', label: 'See where my time goes', phrase: 'Understand where my time actually goes.' },
  { id: 'focus', label: 'Protect my focus', phrase: 'Protect my focus and catch distractions early.' },
  { id: 'recall', label: 'Remember what I did', phrase: 'Remember what I worked on without taking notes.' },
  { id: 'ask-ai', label: 'Ask AI about my work', phrase: 'Ask AI specific questions about my week.' },
]

const MAC_STEPS: Array<{ id: OnboardingStage[]; label: string }> = [
  { id: ['welcome'], label: 'Meet Daylens' },
  { id: ['permission', 'relaunch_required', 'verifying_permission'], label: 'Grant access' },
  { id: ['proof'], label: 'First signal' },
  { id: ['tour'], label: 'How it works' },
  { id: ['personalize'], label: 'Make it yours' },
  { id: ['ai_setup'], label: 'Set up AI' },
  { id: ['ready'], label: 'Ready' },
]

const NON_MAC_STEPS: Array<{ id: OnboardingStage[]; label: string }> = [
  { id: ['welcome'], label: 'Meet Daylens' },
  { id: ['proof'], label: 'First signal' },
  { id: ['tour'], label: 'How it works' },
  { id: ['personalize'], label: 'Make it yours' },
  { id: ['ai_setup'], label: 'Set up AI' },
  { id: ['ready'], label: 'Ready' },
]

// The macro flow used for the Back button. The mac permission stage is omitted:
// it auto-advances once access is granted, so stepping back into it would bounce
// the user forward again.
const STAGE_FLOW: OnboardingStage[] = ['welcome', 'proof', 'tour', 'personalize', 'ai_setup', 'ready']
const SYSTEM_STAGES = new Set<OnboardingStage>(['relaunch_required', 'verifying_permission'])

// The guided tour: every surface, as few words as possible, one visual each.
const TOUR_CARDS = [
  {
    key: 'timeline',
    title: 'Your day, in blocks',
    body: 'Daylens groups activity by what you were doing — not which app was open. One block is one stretch of one thing. Taller means longer.',
  },
  {
    key: 'ask',
    title: 'Open an app, or just ask',
    body: 'Pick any app to see what you actually did in it. Or ask in plain words — answers come from your real activity, never guesses.',
  },
  {
    key: 'briefs',
    title: 'Briefs and wraps, written fresh',
    body: 'A morning brief on what to pick up. An evening wrap of what got done. Weekly and monthly wraps, Spotify-style — all from the same numbers.',
  },
] as const

interface ProofSnapshot {
  liveSession: LiveSession | null
  timeline: DayTimelinePayload | null
  ready: boolean
}

function StageHeading({
  title,
  body,
}: {
  title: string
  body?: string
}) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <h1 className="onboarding-title">{title}</h1>
      {body && <p className="onboarding-sub">{body}</p>}
    </div>
  )
}

function ProgressDots({ count, activeIndex }: { count: number; activeIndex: number }) {
  return (
    <div className="onboarding-dots" aria-label="Setup progress">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`onboarding-dot${i === activeIndex ? ' onboarding-dot-active' : i < activeIndex ? ' onboarding-dot-done' : ''}`}
        />
      ))}
    </div>
  )
}


function SettingsPreview() {
  return (
    <div className="onboarding-settings-mock" aria-hidden="true">
      <div className="onboarding-settings-mock-header">
        <div className="onboarding-settings-mock-dot" style={{ background: '#ff5f56' }} />
        <div className="onboarding-settings-mock-dot" style={{ background: '#ffbd2e' }} />
        <div className="onboarding-settings-mock-dot" style={{ background: '#27c93f' }} />
        <div className="onboarding-settings-mock-title">Privacy & Security — Daylens capture</div>
      </div>
      <div className="onboarding-settings-mock-body">
        <div className="onboarding-settings-mock-row onboarding-settings-mock-row-other">
          <span className="onboarding-settings-mock-app">Loom</span>
          <span className="onboarding-settings-mock-toggle on" />
        </div>
        <div className="onboarding-settings-mock-row onboarding-settings-mock-row-target">
          <span className="onboarding-settings-mock-app">
            <span className="onboarding-settings-mock-badge">Daylens</span>
          </span>
          <span className="onboarding-settings-mock-toggle off" />
        </div>
        <div className="onboarding-settings-mock-row onboarding-settings-mock-row-other">
          <span className="onboarding-settings-mock-app">Zoom</span>
          <span className="onboarding-settings-mock-toggle on" />
        </div>
      </div>
      <div className="onboarding-settings-mock-hint">Flip the Daylens toggle on, then return to this window.</div>
    </div>
  )
}


function TourVisual({ kind, name }: { kind: string; name: string }) {
  if (kind === 'timeline') {
    const rows = [
      { label: 'Configuring the work network', h: 64, tone: 'a' },
      { label: 'ML pipeline class', h: 40, tone: 'b' },
      { label: 'Networking in Ghostty', h: 52, tone: 'c' },
    ]
    return (
      <div className="onboarding-tour-visual" aria-hidden="true">
        <div className="onboarding-tour-timeline">
          {rows.map((row) => (
            <div key={row.label} className="onboarding-tour-block" style={{ height: row.h }} data-tone={row.tone}>
              <span>{row.label}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (kind === 'ask') {
    return (
      <div className="onboarding-tour-visual" aria-hidden="true">
        <div className="onboarding-tour-chat">
          <div className="onboarding-tour-bubble onboarding-tour-bubble-q">What did I ship this week?</div>
          <div className="onboarding-tour-bubble onboarding-tour-bubble-a">
            You shipped the timeline rework and fixed the Windows capture bugs — about 12h across Cursor and Ghostty.
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="onboarding-tour-visual" aria-hidden="true">
      <div className="onboarding-tour-notif">
        <div className="onboarding-tour-notif-head">
          <span className="onboarding-tour-notif-dot" />
          Daylens · morning brief
        </div>
        <div className="onboarding-tour-notif-body">
          Good morning{name ? `, ${name}` : ''}. The malaria notebook was still open yesterday — pick it up?
        </div>
      </div>
      <div className="onboarding-tour-stats">
        <div><strong>6h 12m</strong><span>deep work</span></div>
        <div><strong>4</strong><span>projects</span></div>
        <div><strong>Tue</strong><span>busiest day</span></div>
      </div>
    </div>
  )
}

export default function Onboarding({
  initialSettings,
  onComplete,
}: {
  initialSettings: AppSettings
  onComplete: () => void
}) {
  const [settings, setSettings] = useState(initialSettings)
  const [goals, setGoals] = useState<Set<string>>(new Set(initialSettings.userGoals))
  const [nameDraft, setNameDraft] = useState(initialSettings.userName)
  const [intentDraft, setIntentDraft] = useState(initialSettings.userIntent)
  const [aiConnected, setAiConnected] = useState(initialSettings.onboardingState.aiSetupState === 'connected')
  const [tourIndex, setTourIndex] = useState(0)
  // T3: opt-in to Tracking Controls during onboarding. Off by default —
  // declining (the default) changes nothing about capture.
  const [trackingOptIn, setTrackingOptIn] = useState(initialSettings.trackingControlsEnabled ?? false)
  const [defaultUserName, setDefaultUserName] = useState('')
  const [permissionState, setPermissionState] = useState<TrackingPermissionState>(initialSettings.onboardingState.trackingPermissionState)
  const [permissionDetails, setPermissionDetails] = useState<TrackingPermissionDetails | null>(null)
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [proof, setProof] = useState<ProofSnapshot>({ liveSession: null, timeline: null, ready: false })
  const [linuxTracking, setLinuxTracking] = useState<LinuxTrackingDiagnostics | null>(null)
  const [settingsHandoff, setSettingsHandoff] = useState(false)
  const onboardingTrackedRef = useRef(false)
  const proofTrackedRef = useRef(false)
  const onboardingStateRef = useRef(settings.onboardingState)

  const platform = settings.onboardingState.platform
  const stage = settings.onboardingState.stage
  const isMac = platform === 'macos'
  const isLinux = platform === 'linux'
  const steps = isMac ? MAC_STEPS : NON_MAC_STEPS
  const activeStepIndex = useMemo(() => {
    const idx = steps.findIndex((s) => s.id.includes(stage))
    if (idx >= 0) return idx
    return stage === 'complete' ? steps.length : 0
  }, [steps, stage])

  useEffect(() => {
    if (onboardingTrackedRef.current) return
    onboardingTrackedRef.current = true
    track(ANALYTICS_EVENT.ONBOARDING_STARTED, {
      stage,
      surface: 'onboarding',
      trigger: 'navigation',
    })
  }, [stage])

  useEffect(() => {
    onboardingStateRef.current = settings.onboardingState
  }, [settings.onboardingState])

  useEffect(() => {
    let cancelled = false
    ipc.app.getDefaultUserName()
      .then((name) => {
        if (!cancelled) setDefaultUserName(name)
      })
      .catch(() => {
        if (!cancelled) setDefaultUserName('')
      })
    return () => { cancelled = true }
  }, [])

  async function persistOnboarding(
    nextStage: OnboardingStage,
    partial: Partial<AppSettings['onboardingState']> = {},
  ) {
    const nextState = {
      ...settings.onboardingState,
      ...partial,
      stage: nextStage,
    }
    setSettings((current) => ({ ...current, onboardingState: nextState }))
    await ipc.settings.set({ onboardingState: nextState })
  }

  async function refreshPermissionState() {
    if (!isMac) return
    const [nextState, details] = await Promise.all([
      ipc.tracking.getPermissionState(),
      ipc.tracking.getPermissionDetails(),
    ])
    setPermissionState(nextState)
    setPermissionDetails(details)

    if (nextState !== 'granted') {
      if (stage === 'verifying_permission') {
        await persistOnboarding('permission', {
          trackingPermissionState: nextState,
          proofState: 'idle',
        })
      }
      return
    }

    const nextStage = nextMacStageAfterGrantedPermission({
      currentStage: stage,
      permissionRequestedAt: settings.onboardingState.permissionRequestedAt,
      origin: 'refresh',
    })

    if (!nextStage) return

    if (nextStage === 'relaunch_required') {
      await persistOnboarding('relaunch_required', {
        trackingPermissionState: 'awaiting_relaunch',
      })
      return
    }

    if (nextStage === 'verifying_permission') {
      await persistOnboarding('verifying_permission', {
        trackingPermissionState: 'granted',
      })
      return
    }

    if (nextStage === 'proof') {
      await persistOnboarding('proof', {
        trackingPermissionState: 'granted',
        proofState: 'collecting',
        permissionRequestedAt: null,
      })
    }
  }

  useEffect(() => {
    if (!isMac || stage !== 'permission') return
    void refreshPermissionState()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMac, stage, settings.onboardingState.permissionRequestedAt])

  useEffect(() => {
    if (!isMac || stage !== 'verifying_permission') return

    const timer = window.setTimeout(() => {
      void refreshPermissionState()
    }, 650)

    return () => {
      window.clearTimeout(timer)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMac, stage, settings.onboardingState.permissionRequestedAt])

  // While the user is in System Settings we refocus-check on window focus.
  useEffect(() => {
    if (!isMac || stage !== 'permission' || !settingsHandoff) return
    const onFocus = () => { void refreshPermissionState() }
    window.addEventListener('focus', onFocus)
    const interval = window.setInterval(() => { void refreshPermissionState() }, 2_000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(interval)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMac, stage, settingsHandoff])

  useEffect(() => {
    if (stage !== 'proof') return

    let cancelled = false

    async function loadProof() {
      try {
        const [timeline, liveSession, diagnostics] = await Promise.all([
          ipc.db.getTimelineDay(todayString()).catch(() => null),
          ipc.tracking.getLiveSession().catch(() => null),
          isLinux ? ipc.tracking.getDiagnostics().catch(() => null) : Promise.resolve(null),
        ])
        if (cancelled) return

        if (isLinux && diagnostics?.linuxTracking) {
          setLinuxTracking(diagnostics.linuxTracking)
        }

        const ready = Boolean(
          liveSession
          || (timeline && (
            timeline.totalSeconds > 0
            || timeline.blocks.length > 0
            || timeline.siteCount > 0
            || timeline.segments.length > 0
          )),
        )

        setProof({ liveSession, timeline, ready })

        const nextProofState: ProofState = ready ? 'ready' : 'collecting'
        const currentOnboardingState = onboardingStateRef.current
        if (currentOnboardingState.proofState !== nextProofState || currentOnboardingState.stage !== 'proof') {
          const nextState = {
            ...currentOnboardingState,
            stage: 'proof' as const,
            proofState: nextProofState,
          }
          setSettings((current) => ({ ...current, onboardingState: nextState }))
          await ipc.settings.set({ onboardingState: nextState })
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : String(err))
        }
      }
    }

    void loadProof()
    const interval = window.setInterval(() => { void loadProof() }, 2_500)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [stage, isLinux])

  useEffect(() => {
    if (!proof.ready || proofTrackedRef.current) return
    proofTrackedRef.current = true
    track(ANALYTICS_EVENT.TRACKING_PROOF_READY, {
      block_count_bucket: blockCountBucket(proof.timeline?.blocks.length ?? 0),
      surface: 'onboarding',
      tracked_time_bucket: trackedTimeBucket(proof.timeline?.totalSeconds ?? 0),
      trigger: 'system',
      view: 'onboarding',
    })
  }, [proof.ready, proof.timeline])

  function toggleIntent(id: string) {
    const intent = INTENTS.find((item) => item.id === id)
    if (!intent) return
    const selecting = !goals.has(id)
    setGoals((previous) => {
      const next = new Set(previous)
      if (selecting) next.add(id)
      else next.delete(id)
      return next
    })
    // Chips auto-fill the free-text box; the box stays the source of truth for userIntent.
    setIntentDraft((current) => {
      const trimmed = current.trim()
      if (selecting) {
        if (trimmed.includes(intent.phrase)) return current
        return trimmed ? `${trimmed} ${intent.phrase}` : intent.phrase
      }
      return trimmed.replace(intent.phrase, '').replace(/\s{2,}/g, ' ').trim()
    })
  }

  async function finishOnboarding() {
    if (busy) return
    setBusy(true)
    setErrorMessage(null)

    const completedAt = Date.now()
    const nextOnboardingState = {
      ...settings.onboardingState,
      stage: 'complete' as const,
      proofState: 'ready' as const,
      personalizationState: 'completed' as const,
      aiSetupState: aiConnected ? ('connected' as const) : settings.onboardingState.aiSetupState,
      completedAt,
    }

    try {
      await ipc.settings.set({
        onboardingComplete: true,
        onboardingState: nextOnboardingState,
        userName: nameDraft.trim(),
        userGoals: Array.from(goals),
        userIntent: intentDraft.trim(),
        trackingControlsEnabled: trackingOptIn,
      })
      await ipc.app.completeOnboarding()
      track(ANALYTICS_EVENT.ONBOARDING_COMPLETED, {
        platform,
        selected_goal_count: goals.size,
        surface: 'onboarding',
      })
      onComplete()
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function beginPermissionRequest() {
    setBusy(true)
    setErrorMessage(null)
    try {
      const requestedAt = Date.now()
      const nextState = await ipc.tracking.requestScreenPermission()
      setPermissionState(nextState)
      setPermissionDetails(await ipc.tracking.getPermissionDetails())
      setSettingsHandoff(nextState !== 'granted' && nextState !== 'awaiting_relaunch')
      if (nextState === 'awaiting_relaunch') {
        await persistOnboarding('relaunch_required', {
          trackingPermissionState: nextState,
          permissionRequestedAt: requestedAt,
        })
      } else {
        await persistOnboarding('permission', {
          trackingPermissionState: nextState,
          permissionRequestedAt: requestedAt,
        })
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleContinueFromWelcome() {
    track(ANALYTICS_EVENT.ONBOARDING_STEP_COMPLETED, {
      platform,
      step: 'welcome',
      surface: 'onboarding',
    })
    await persistOnboarding(isMac ? 'permission' : 'proof', {
      proofState: isMac ? 'idle' : 'collecting',
    })
  }

  async function continueFromProof() {
    track(ANALYTICS_EVENT.ONBOARDING_STEP_COMPLETED, {
      platform,
      step: 'proof',
      surface: 'onboarding',
    })
    await persistOnboarding('tour', {
      proofState: proof.ready ? 'ready' : settings.onboardingState.proofState,
    })
  }

  function advanceTour() {
    if (tourIndex < TOUR_CARDS.length - 1) {
      setTourIndex((index) => index + 1)
      return
    }
    track(ANALYTICS_EVENT.ONBOARDING_STEP_COMPLETED, { platform, step: 'tour', surface: 'onboarding' })
    void persistOnboarding('personalize')
  }

  const flowIndex = STAGE_FLOW.indexOf(stage)
  const canGoBack = !SYSTEM_STAGES.has(stage) && ((stage === 'tour' && tourIndex > 0) || flowIndex > 0)

  function goBack() {
    if (stage === 'tour' && tourIndex > 0) {
      setTourIndex((index) => index - 1)
      return
    }
    const previous = STAGE_FLOW[flowIndex - 1]
    if (!previous) return
    void persistOnboarding(previous)
  }

  async function continueFromPersonalize() {
    track(ANALYTICS_EVENT.ONBOARDING_STEP_COMPLETED, {
      platform,
      step: 'personalize',
      surface: 'onboarding',
    })
    // Persist identity now so a reload mid-flow keeps it.
    await ipc.settings.set({
      userName: nameDraft.trim(),
      userGoals: Array.from(goals),
      userIntent: intentDraft.trim(),
      trackingControlsEnabled: trackingOptIn,
    })
    await persistOnboarding('ai_setup', { personalizationState: 'completed' })
  }

  async function continueFromAiSetup() {
    track(ANALYTICS_EVENT.ONBOARDING_STEP_COMPLETED, {
      platform,
      step: 'ai_setup',
      surface: 'onboarding',
    })
    await persistOnboarding('ready', {
      aiSetupState: aiConnected ? 'connected' : 'dismissed',
    })
  }

  const permissionStatusLabel =
    permissionState === 'granted'
      ? 'Enabled'
      : permissionState === 'awaiting_relaunch'
        ? 'Ready to restart'
        : settingsHandoff
          ? 'Waiting on you in System Settings'
          : 'Not yet enabled'

  const permissionStatusTone: 'ok' | 'waiting' | 'pending' =
    permissionState === 'granted' || permissionState === 'awaiting_relaunch'
      ? 'ok'
      : settingsHandoff
        ? 'waiting'
        : 'pending'

  return (
    <div className="onboarding-root">
      <div className="onboarding-shell">
        <div className="onboarding-topbar">
          {canGoBack
            ? <button className="onboarding-back" onClick={goBack}>← Back</button>
            : <span className="onboarding-back-placeholder" />}
          <ProgressDots count={steps.length} activeIndex={activeStepIndex} />
        </div>

        {stage === 'welcome' && (
          <div className="onboarding-screen">
            <h1 className="onboarding-title onboarding-title-large">
              An honest picture of your day — built privately on your own machine.
            </h1>
            <p className="onboarding-sub">
              Daylens quietly notices what you work on and turns it into a clear timeline.
              Nothing leaves your computer unless you ask it to. No screenshots, no video, no scores.
            </p>
            <div className="onboarding-actions">
              <button className="onboarding-btn-primary" onClick={() => void handleContinueFromWelcome()}>
                {isMac ? 'Get started' : 'Start tracking'}
              </button>
            </div>
            <p className="onboarding-reassurance">Private by default · stays on this device · no judgment</p>
          </div>
        )}

        {stage === 'permission' && (
          <div className="onboarding-screen">
            <StageHeading title="Daylens needs Accessibility and Screen Recording to read window titles — no screenshots or video." />
            <SettingsPreview />
            <div className="onboarding-actions">
              <button className="onboarding-btn-primary" onClick={() => void beginPermissionRequest()} disabled={busy}>
                {busy ? 'Opening System Settings…' : 'Open Privacy & Security'}
              </button>
              <button className="onboarding-btn-secondary" onClick={() => void refreshPermissionState()}>
                I already enabled it
              </button>
            </div>
            <p className="onboarding-reassurance">Everything stays on your device. No screenshots, no video, ever.</p>
            <div className={`onboarding-status onboarding-status-${permissionStatusTone}`}>
              <span className="onboarding-status-dot" />
              <span className="onboarding-status-label">{permissionStatusLabel}</span>
              {settingsHandoff && (
                <span className="onboarding-status-note">
                  Keep this window open — we will pick up the moment the toggle flips.
                </span>
              )}
            </div>
            {permissionDetails && (
              <div className="onboarding-status onboarding-status-pending">
                <span className="onboarding-status-label">
                  Accessibility: {permissionDetails.accessibility === 'granted' ? 'Enabled' : 'Missing'}
                  {' · '}
                  Screen Recording: {permissionDetails.screenRecording === 'granted' ? 'Enabled' : 'Missing'}
                </span>
              </div>
            )}
          </div>
        )}

        {stage === 'relaunch_required' && (
          <div className="onboarding-screen">
            <StageHeading title="Daylens has the permission. macOS needs one restart to hand it over." />
            <div className="onboarding-handoff">
              <div className="onboarding-handoff-beam" aria-hidden="true">
                <div className="onboarding-handoff-pulse" />
              </div>
              <div className="onboarding-handoff-copy">
                <div className="onboarding-callout-title">What happens next</div>
                <div className="onboarding-callout-body">
                  Daylens closes and reopens. Your setup picks up exactly where you left it — no data resets, no lost progress.
                </div>
              </div>
            </div>
            <div className="onboarding-actions">
              <button className="onboarding-btn-primary" onClick={() => void ipc.app.relaunch()}>
                Restart Daylens
              </button>
            </div>
          </div>
        )}

        {stage === 'verifying_permission' && (
          <div className="onboarding-screen">
            <StageHeading title="Checking in with macOS and warming up the tracker." />
            <div className="onboarding-verify">
              <div className="onboarding-breath" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="onboarding-verify-copy">
                <div className="onboarding-callout-title">Verifying capture permissions</div>
                <div className="onboarding-callout-body">
                  This should take a second or two. If it is taking longer, macOS may not have saved the toggle — we will recover automatically.
                </div>
              </div>
            </div>
          </div>
        )}

        {stage === 'proof' && (
          <div className="onboarding-screen">
            {proof.ready ? (
              <>
                <StageHeading title="Here's what we've picked up so far." />
                <div className="onboarding-proof-visual">
                  <div className="onboarding-live-activity">
                    {proof.liveSession && (
                      <div className="onboarding-live-row onboarding-live-row-active">
                        <div className="onboarding-live-pulse" aria-hidden="true" />
                        <div>
                          <div className="onboarding-live-app">{proof.liveSession.appName}</div>
                          {proof.liveSession.windowTitle && (
                            <div className="onboarding-live-title">{proof.liveSession.windowTitle}</div>
                          )}
                        </div>
                      </div>
                    )}
                    {proof.timeline && proof.timeline.totalSeconds > 0 && (
                      <div className="onboarding-live-row">
                        <div className="onboarding-live-stat">{Math.round(proof.timeline.totalSeconds / 60)}m</div>
                        <div className="onboarding-live-label">tracked today across {proof.timeline.blocks.length} session{proof.timeline.blocks.length !== 1 ? 's' : ''}</div>
                      </div>
                    )}
                    {proof.timeline && proof.timeline.siteCount > 0 && (
                      <div className="onboarding-live-row">
                        <div className="onboarding-live-stat">{proof.timeline.siteCount}</div>
                        <div className="onboarding-live-label">browser site{proof.timeline.siteCount !== 1 ? 's' : ''} already flowing in</div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="onboarding-proof-pending">
                <div className="onboarding-breath" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                {isLinux && linuxTracking && linuxTracking.supportLevel !== 'ready' ? (
                  <p>{linuxTracking.supportMessage} Open Settings → Capture health after setup for the full picture.</p>
                ) : (
                  <p>Have a great day. Daylens will keep listening for real work signal.</p>
                )}
              </div>
            )}
            <div className="onboarding-actions">
              <button className="onboarding-btn-primary" disabled={!proof.ready} onClick={() => void continueFromProof()}>
                {proof.ready ? 'Continue' : 'Waiting for the first signal…'}
              </button>
            </div>
          </div>
        )}

        {stage === 'tour' && (() => {
          const card = TOUR_CARDS[Math.min(tourIndex, TOUR_CARDS.length - 1)]
          const isLast = tourIndex >= TOUR_CARDS.length - 1
          return (
            <div className="onboarding-screen">
              <TourVisual kind={card.key} name={nameDraft.trim()} />
              <StageHeading title={card.title} body={card.body} />
              <div className="onboarding-tour-progress" aria-hidden="true">
                {TOUR_CARDS.map((tourCard, index) => (
                  <span key={tourCard.key} className={`onboarding-tour-pip${index === tourIndex ? ' onboarding-tour-pip-active' : ''}`} />
                ))}
              </div>
              <div className="onboarding-actions">
                <button className="onboarding-btn-primary" onClick={() => advanceTour()}>
                  {isLast ? 'Make it mine' : 'Next'}
                </button>
              </div>
            </div>
          )
        })()}

        {stage === 'personalize' && (
          <div className="onboarding-screen">
            <StageHeading
              title="Make it yours."
              body="Your name is just for the morning brief. Tell Daylens why you're here so it points you at the right answers."
            />
            <label className="onboarding-name-field">
              <input
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                placeholder={defaultUserName || 'Your name'}
                maxLength={80}
              />
            </label>
            <div className="onboarding-goals-grid">
              {INTENTS.map((intent) => {
                const selected = goals.has(intent.id)
                return (
                  <button
                    key={intent.id}
                    className={`onboarding-goal-chip${selected ? ' onboarding-goal-chip-selected' : ''}`}
                    onClick={() => toggleIntent(intent.id)}
                  >
                    {intent.label}
                  </button>
                )
              })}
            </div>
            <textarea
              value={intentDraft}
              onChange={(event) => setIntentDraft(event.target.value)}
              placeholder="Tap a few above, or write it in your own words…"
              maxLength={400}
              rows={3}
              style={{
                width: '100%', resize: 'none', fontFamily: 'inherit',
                border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14,
                background: 'rgba(255,255,255,0.03)', color: '#f0f4ff',
                padding: '12px 14px', fontSize: 14, lineHeight: 1.6, outline: 'none',
              }}
            />
            <button
              type="button"
              onClick={() => setTrackingOptIn((v) => !v)}
              aria-pressed={trackingOptIn}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
                padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                border: `1px solid ${trackingOptIn ? 'rgba(90,179,255,0.45)' : 'rgba(173,198,255,0.18)'}`,
                background: trackingOptIn ? 'rgba(90,179,255,0.10)' : 'rgba(255,255,255,0.02)',
                color: '#c2c6d6',
              }}
            >
              <span style={{
                flexShrink: 0, marginTop: 1, width: 18, height: 18, borderRadius: 5,
                border: `1.5px solid ${trackingOptIn ? '#5ab3ff' : 'rgba(173,198,255,0.4)'}`,
                background: trackingOptIn ? '#5ab3ff' : 'transparent',
                display: 'grid', placeItems: 'center', color: '#07090f', fontSize: 12, fontWeight: 900,
              }}>{trackingOptIn ? '✓' : ''}</span>
              <span style={{ display: 'grid', gap: 2 }}>
                <span style={{ fontSize: 13.5, fontWeight: 650, color: '#f0f4ff' }}>Keep private apps and sites out of Daylens</span>
                <span style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.5, color: '#c2c6d6' }}>
                  Optional. Lets you exclude specific apps and websites and skip incognito windows. You can add them now or later in Settings. Off skips nothing.
                </span>
              </span>
            </button>
            <div className="onboarding-actions">
              <button className="onboarding-btn-primary" onClick={() => void continueFromPersonalize()} disabled={busy}>
                Continue
              </button>
            </div>
          </div>
        )}

        {stage === 'ai_setup' && (
          <div className="onboarding-screen">
            <StageHeading
              title="Turn on AI so Daylens can answer on day one."
              body="Connect your own provider key. It stays in your OS keychain, billing stays with your provider, and you can change it anytime in Settings. Optional — skip and add it later."
            />
            <ConnectAI
              variant="embedded"
              initialProvider={settings.aiProvider}
              hasSavedAccess={aiConnected}
              onConnected={() => setAiConnected(true)}
            />
            <div className="onboarding-actions">
              <button className="onboarding-btn-primary" onClick={() => void continueFromAiSetup()} disabled={busy}>
                {aiConnected ? 'Continue' : 'Skip for now'}
              </button>
            </div>
          </div>
        )}

        {stage === 'ready' && (
          <div className="onboarding-screen">
            <StageHeading
              title={nameDraft.trim() ? `You're all set, ${nameDraft.trim()}.` : "You're all set."}
              body="Daylens is watching quietly in the background. As your day fills in, your timeline names each stretch by what you were actually doing."
            />
            {intentDraft.trim() && (
              <div className="onboarding-summary-tile onboarding-summary-tile-highlight">
                <div className="onboarding-summary-label">What you're here for</div>
                <div className="onboarding-summary-detail" style={{ marginTop: 6 }}>{intentDraft.trim()}</div>
              </div>
            )}
            <div style={{ display: 'grid', gap: 8 }}>
              <div className="onboarding-summary-label">
                {aiConnected ? 'Try asking Daylens' : 'Once you connect AI, you can ask'}
              </div>
              {['What did I work on today?', 'Where did my time go this week?', 'Introduce me to how Daylens works.'].map((q) => (
                <div key={q} className="onboarding-goal-chip" style={{ cursor: 'default' }}>{q}</div>
              ))}
            </div>
            <div className="onboarding-actions">
              <button className="onboarding-btn-primary" onClick={() => void finishOnboarding()} disabled={busy}>
                {busy ? 'Opening Daylens…' : 'Open Daylens'}
              </button>
            </div>
          </div>
        )}

        {errorMessage && <div className="onboarding-error">{errorMessage}</div>}
      </div>

      <style>{`
        .onboarding-root {
          position: fixed;
          inset: 0;
          background:
            radial-gradient(circle at 18% 12%, rgba(26, 111, 212, 0.14), transparent 42%),
            radial-gradient(circle at 86% 88%, rgba(90, 179, 255, 0.10), transparent 40%),
            #07090f;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 36px 24px;
          -webkit-app-region: drag;
          /* Onboarding is always dark — pin the dark palette so embedded
             components (e.g. ConnectAI) never render light-on-dark, regardless
             of the app theme the user picks later. */
          --color-surface: #10131a;
          --color-surface-low: #191c22;
          --color-surface-container: #1d2026;
          --color-surface-high: #272a32;
          --color-surface-highest: #32353c;
          --color-surface-card: #1d2026;
          --color-border-ghost: rgba(255,255,255,0.10);
          --color-text-primary: #f0f4ff;
          --color-text-secondary: #c2c6d6;
          --color-text-tertiary: rgba(194,198,214,0.55);
          --color-primary: #adc6ff;
          --color-primary-contrast: #001a42;
          --color-accent: #adc6ff;
          --color-accent-dim: rgba(173,198,255,0.12);
          --color-focus-green: #4fdbc8;
          --gradient-primary: linear-gradient(135deg, #1a6fd4 0%, #5ab3ff 100%);
        }
        .onboarding-topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          min-height: 24px;
        }
        .onboarding-back {
          -webkit-app-region: no-drag;
          background: none;
          border: none;
          color: rgba(194,198,214,0.7);
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          padding: 4px 8px;
          margin-left: -8px;
          border-radius: 8px;
          transition: color 140ms ease, background 140ms ease;
        }
        .onboarding-back:hover { color: #f0f4ff; background: rgba(255,255,255,0.04); }
        .onboarding-back-placeholder { width: 1px; }
        .onboarding-tour-visual {
          border-radius: 18px;
          border: 1px solid rgba(173, 198, 255, 0.12);
          background: linear-gradient(180deg, rgba(14, 24, 34, 0.7), rgba(9, 14, 22, 0.7));
          padding: 20px;
          min-height: 150px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 12px;
        }
        .onboarding-tour-timeline { display: grid; gap: 8px; }
        .onboarding-tour-block {
          border-radius: 9px;
          display: flex;
          align-items: center;
          padding: 0 12px;
          font-size: 12.5px;
          font-weight: 600;
          color: #eaf1ff;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05);
          animation: onboardingBlockIn 0.5s cubic-bezier(.2,.8,.2,1) both;
        }
        .onboarding-tour-block[data-tone="a"] { background: linear-gradient(135deg, rgba(125,191,255,0.34), rgba(79,220,200,0.22)); }
        .onboarding-tour-block[data-tone="b"] { background: rgba(255,255,255,0.06); color: rgba(210,222,240,0.8); animation-delay: 0.08s; }
        .onboarding-tour-block[data-tone="c"] { background: linear-gradient(135deg, rgba(178,160,255,0.32), rgba(125,191,255,0.22)); animation-delay: 0.16s; }
        .onboarding-tour-chat { display: grid; gap: 10px; }
        .onboarding-tour-bubble {
          font-size: 13px;
          line-height: 1.55;
          padding: 10px 13px;
          border-radius: 13px;
          max-width: 86%;
        }
        .onboarding-tour-bubble-q {
          justify-self: end;
          background: linear-gradient(145deg, #1a6fd4, #5ab3ff);
          color: #fff;
          border-bottom-right-radius: 4px;
        }
        .onboarding-tour-bubble-a {
          justify-self: start;
          background: rgba(255,255,255,0.05);
          color: #d9e2f2;
          border: 1px solid rgba(173,198,255,0.12);
          border-bottom-left-radius: 4px;
        }
        .onboarding-tour-notif {
          border-radius: 13px;
          border: 1px solid rgba(173,198,255,0.16);
          background: rgba(255,255,255,0.04);
          padding: 12px 14px;
        }
        .onboarding-tour-notif-head {
          display: flex; align-items: center; gap: 7px;
          font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
          color: rgba(194,198,214,0.6); text-transform: uppercase;
        }
        .onboarding-tour-notif-dot { width: 7px; height: 7px; border-radius: 50%; background: #5ab3ff; }
        .onboarding-tour-notif-body { margin-top: 7px; font-size: 13.5px; line-height: 1.55; color: #eaf1ff; }
        .onboarding-tour-stats { display: flex; gap: 10px; }
        .onboarding-tour-stats > div {
          flex: 1; text-align: center;
          border-radius: 11px; padding: 10px 6px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(173,198,255,0.10);
        }
        .onboarding-tour-stats strong { display: block; font-size: 16px; font-weight: 740; color: #f0f4ff; }
        .onboarding-tour-stats span { font-size: 10.5px; color: rgba(194,198,214,0.6); }
        .onboarding-tour-progress { display: flex; gap: 6px; }
        .onboarding-tour-pip { width: 6px; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.14); transition: width 240ms ease, background 240ms ease; }
        .onboarding-tour-pip-active { width: 16px; background: linear-gradient(145deg, #1a6fd4, #5ab3ff); }
        .onboarding-shell {
          width: min(780px, 100%);
          border-radius: 32px;
          border: 1px solid rgba(173, 198, 255, 0.18);
          background: linear-gradient(180deg, rgba(12, 18, 27, 0.92), rgba(8, 12, 18, 0.92));
          box-shadow: 0 30px 90px rgba(0, 0, 0, 0.45);
          padding: 24px 32px 20px;
          -webkit-app-region: no-drag;
          backdrop-filter: blur(22px);
          display: grid;
          gap: 16px;
        }
        .onboarding-dots {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .onboarding-dot {
          height: 6px;
          width: 6px;
          border-radius: 3px;
          background: rgba(255, 255, 255, 0.1);
          transition: width 300ms ease, background 300ms ease;
        }
        .onboarding-dot-done {
          background: rgba(90, 179, 255, 0.52);
        }
        .onboarding-dot-active {
          width: 18px;
          background: linear-gradient(145deg, #1a6fd4 0%, #5ab3ff 100%);
        }
        .onboarding-screen {
          display: grid;
          gap: 16px;
        }
        .onboarding-eyebrow {
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(194,198,214,0.5);
        }
        .onboarding-title {
          margin: 0;
          font-size: 30px;
          line-height: 1.1;
          letter-spacing: -0.03em;
          color: #f0f4ff;
        }
        .onboarding-title-large {
          font-size: 40px;
          line-height: 1.08;
        }
        .onboarding-sub {
          margin: 0;
          font-size: 14.5px;
          line-height: 1.7;
          color: #c2c6d6;
          max-width: 62ch;
        }
        .onboarding-reassure {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .onboarding-reassure-pill {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          padding: 5px 11px;
          border-radius: 999px;
          border: 1px solid rgba(173, 198, 255, 0.16);
          background: rgba(255, 255, 255, 0.02);
          color: #c2c6d6;
        }
        .onboarding-preview {
          display: grid;
          gap: 8px;
          padding: 18px 18px 14px;
          border-radius: 18px;
          border: 1px solid rgba(173, 198, 255, 0.10);
          background: linear-gradient(180deg, rgba(14, 24, 34, 0.82), rgba(9, 14, 22, 0.82));
        }
        .onboarding-preview-axis {
          display: flex;
          justify-content: space-between;
          font-family: 'SF Mono', ui-monospace, monospace;
          font-size: 10px;
          color: rgba(180, 200, 220, 0.45);
          letter-spacing: 0.08em;
        }
        .onboarding-preview-track {
          position: relative;
          height: 44px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.025);
          overflow: hidden;
        }
        .onboarding-preview-block {
          position: absolute;
          top: 6px;
          bottom: 6px;
          border-radius: 7px;
          display: flex;
          align-items: center;
          padding: 0 10px;
          color: rgba(225, 236, 248, 0.88);
          font-size: 10.5px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          animation: onboardingBlockIn 1.2s cubic-bezier(.2,.8,.2,1) both;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
        }
        .onboarding-preview-block-a { background: linear-gradient(135deg, rgba(125, 191, 255, 0.35), rgba(79, 220, 200, 0.25)); animation-delay: 0s; }
        .onboarding-preview-block-b { background: rgba(255, 255, 255, 0.05); color: rgba(180, 200, 220, 0.5); animation-delay: 0.15s; }
        .onboarding-preview-block-c { background: linear-gradient(135deg, rgba(79, 220, 200, 0.38), rgba(125, 191, 255, 0.26)); animation-delay: 0.3s; }
        .onboarding-preview-block-d { background: linear-gradient(135deg, rgba(178, 160, 255, 0.32), rgba(125, 191, 255, 0.22)); animation-delay: 0.45s; }
        .onboarding-preview-block-e { background: linear-gradient(135deg, rgba(255, 191, 143, 0.32), rgba(219, 146, 102, 0.22)); animation-delay: 0.6s; }
        .onboarding-preview-caption {
          font-size: 11.5px;
          color: rgba(180, 200, 220, 0.55);
        }
        .onboarding-permission-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(240px, 300px);
          gap: 16px;
          align-items: start;
        }
        .onboarding-steps-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 12px;
        }
        .onboarding-steps-list li {
          display: grid;
          grid-template-columns: 28px 1fr;
          gap: 12px;
          align-items: start;
        }
        .onboarding-steps-index {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: rgba(125, 191, 255, 0.12);
          color: #b7d3ff;
          font-size: 11.5px;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-top: 1px;
        }
        .onboarding-steps-title {
          font-size: 13.5px;
          font-weight: 650;
          color: #f0f4ff;
          letter-spacing: -0.01em;
        }
        .onboarding-steps-body {
          font-size: 12.5px;
          color: #c2c6d6;
          line-height: 1.55;
          margin-top: 2px;
        }
        .onboarding-settings-mock {
          border-radius: 16px;
          border: 1px solid rgba(173, 198, 255, 0.14);
          background: linear-gradient(180deg, rgba(30, 36, 46, 0.96), rgba(18, 24, 32, 0.96));
          overflow: hidden;
          box-shadow: 0 18px 44px rgba(0, 0, 0, 0.4);
        }
        .onboarding-settings-mock-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 9px 12px;
          background: rgba(255, 255, 255, 0.03);
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }
        .onboarding-settings-mock-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
        }
        .onboarding-settings-mock-title {
          margin-left: 8px;
          font-size: 10.5px;
          color: rgba(220, 230, 240, 0.8);
          font-weight: 600;
        }
        .onboarding-settings-mock-body {
          padding: 8px 4px;
        }
        .onboarding-settings-mock-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          border-radius: 8px;
          margin: 0 6px;
          transition: background 160ms ease;
        }
        .onboarding-settings-mock-row-target {
          background: rgba(125, 191, 255, 0.10);
          box-shadow: inset 0 0 0 1px rgba(125, 191, 255, 0.35);
          animation: onboardingMockHighlight 2.8s ease-in-out infinite;
        }
        .onboarding-settings-mock-app {
          font-size: 12px;
          color: rgba(225, 235, 245, 0.82);
          font-weight: 500;
        }
        .onboarding-settings-mock-badge {
          font-weight: 700;
          color: #eef6ff;
        }
        .onboarding-settings-mock-toggle {
          width: 28px;
          height: 17px;
          border-radius: 999px;
          position: relative;
          transition: background 180ms ease;
        }
        .onboarding-settings-mock-toggle::after {
          content: '';
          position: absolute;
          top: 2px;
          width: 13px;
          height: 13px;
          border-radius: 50%;
          background: #f5f7fa;
          transition: left 240ms ease;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
        }
        .onboarding-settings-mock-toggle.on { background: #4ac06e; }
        .onboarding-settings-mock-toggle.on::after { left: 13px; }
        .onboarding-settings-mock-toggle.off { background: rgba(255, 255, 255, 0.14); }
        .onboarding-settings-mock-toggle.off::after { left: 2px; }
        .onboarding-settings-mock-row-target .onboarding-settings-mock-toggle {
          animation: onboardingToggleTease 2.8s ease-in-out infinite;
        }
        .onboarding-settings-mock-hint {
          padding: 10px 14px 14px;
          font-size: 11px;
          color: rgba(180, 200, 220, 0.65);
          text-align: center;
          border-top: 1px solid rgba(255, 255, 255, 0.04);
        }
        .onboarding-handoff,
        .onboarding-verify,
        .onboarding-callout,
        .onboarding-proof-card {
          border-radius: 18px;
          border: 1px solid rgba(173, 198, 255, 0.12);
          background: rgba(255, 255, 255, 0.02);
          padding: 18px 18px 16px;
        }
        .onboarding-handoff {
          display: grid;
          grid-template-columns: 120px 1fr;
          gap: 18px;
          align-items: center;
        }
        .onboarding-handoff-beam {
          height: 90px;
          border-radius: 14px;
          background:
            radial-gradient(circle at 50% 50%, rgba(125, 191, 255, 0.22), transparent 65%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0.01));
          position: relative;
          overflow: hidden;
        }
        .onboarding-handoff-pulse {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, transparent, rgba(125, 191, 255, 0.35), transparent);
          animation: onboardingBeam 2.4s linear infinite;
        }
        .onboarding-verify {
          display: grid;
          grid-template-columns: 120px 1fr;
          gap: 18px;
          align-items: center;
        }
        .onboarding-breath {
          height: 90px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }
        .onboarding-breath span {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: linear-gradient(135deg, #1a6fd4 0%, #5ab3ff 100%);
          animation: onboardingBreath 1.4s ease-in-out infinite;
        }
        .onboarding-breath span:nth-child(2) { animation-delay: 0.2s; }
        .onboarding-breath span:nth-child(3) { animation-delay: 0.4s; }
        .onboarding-callout-title,
        .onboarding-summary-label {
          font-size: 10.5px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: rgba(194,198,214,0.5);
        }
        .onboarding-callout-body,
        .onboarding-summary-detail,
        .onboarding-hint {
          font-size: 12.5px;
          line-height: 1.65;
          color: #c2c6d6;
        }
        .onboarding-hint-quiet {
          font-size: 11.5px;
          color: rgba(194,198,214,0.5);
          align-self: center;
        }
        .onboarding-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          align-items: center;
        }
        .onboarding-btn-primary,
        .onboarding-btn-secondary {
          height: 42px;
          padding: 0 18px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 140ms ease, border-color 140ms ease, opacity 140ms ease, box-shadow 180ms ease;
        }
        .onboarding-btn-primary {
          border: none;
          background: linear-gradient(145deg, #1a6fd4 0%, #5ab3ff 100%);
          color: #fff;
          box-shadow: 0 10px 28px rgba(26, 111, 212, 0.32), 0 0 0 1px rgba(173, 198, 255, 0.10) inset;
        }
        .onboarding-btn-primary:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 16px 36px rgba(26, 111, 212, 0.44), 0 0 0 1px rgba(240, 248, 255, 0.16) inset;
        }
        .onboarding-btn-secondary {
          border: 1px solid rgba(255,255,255,0.08);
          background: transparent;
          color: #f0f4ff;
        }
        .onboarding-btn-secondary:hover:not(:disabled) {
          border-color: rgba(173, 198, 255, 0.32);
        }
        .onboarding-btn-primary:disabled,
        .onboarding-btn-secondary:disabled {
          opacity: 0.55;
          cursor: default;
          box-shadow: none;
        }
        .onboarding-status {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          padding: 10px 14px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255, 255, 255, 0.02);
          font-size: 12.5px;
          color: #c2c6d6;
        }
        .onboarding-status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: rgba(180, 200, 220, 0.45);
        }
        .onboarding-status-ok .onboarding-status-dot { background: #4ad18b; box-shadow: 0 0 0 3px rgba(74, 209, 139, 0.18); }
        .onboarding-status-waiting .onboarding-status-dot { background: #f5c662; animation: onboardingPulse 1.6s ease-out infinite; }
        .onboarding-status-label { font-weight: 600; color: #f0f4ff; }
        .onboarding-status-note { color: rgba(194,198,214,0.5); }
        .onboarding-summary-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 12px;
        }
        .onboarding-goals-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .onboarding-name-field {
          display: grid;
          gap: 0;
        }
        .onboarding-name-field input {
          width: 100%;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.03);
          color: #f0f4ff;
          padding: 12px 14px;
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 0;
          text-transform: none;
          outline: none;
        }
        .onboarding-name-field input::placeholder {
          color: rgba(194, 198, 214, 0.45);
        }
        .onboarding-name-field input:focus {
          border-color: rgba(90, 179, 255, 0.58);
          box-shadow: 0 0 0 3px rgba(26, 111, 212, 0.14);
        }
        .onboarding-summary-tile,
        .onboarding-goal-card {
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255, 255, 255, 0.025);
          padding: 14px 14px 12px;
          transition: border-color 160ms ease, background 160ms ease, transform 160ms ease;
        }
        .onboarding-summary-tile-highlight {
          border-color: rgba(125, 191, 255, 0.45);
          background: linear-gradient(180deg, rgba(125, 191, 255, 0.08), rgba(79, 220, 200, 0.04));
          box-shadow: 0 8px 26px rgba(79, 211, 198, 0.14);
        }
        .onboarding-summary-value {
          margin-top: 8px;
          font-size: 18px;
          font-weight: 720;
          color: #f0f4ff;
        }
        .onboarding-goal-chip {
          min-height: 40px;
          padding: 10px 14px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255, 255, 255, 0.025);
          color: #f0f4ff;
          font-size: 13px;
          font-weight: 500;
          text-align: left;
          cursor: pointer;
          transition: border-color 160ms ease, background 160ms ease;
        }
        .onboarding-goal-chip-selected {
          border-color: rgba(90, 179, 255, 0.52);
          background: rgba(26, 111, 212, 0.13);
          color: #d9edff;
        }
        .onboarding-goal-chip:hover:not(.onboarding-goal-chip-selected) {
          border-color: rgba(173, 198, 255, 0.28);
          background: rgba(255, 255, 255, 0.04);
        }
        .onboarding-proof-visual {
          padding: 4px 0 0;
          min-height: 90px;
        }
        .onboarding-live-activity {
          display: grid;
          gap: 14px;
        }
        .onboarding-live-row {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .onboarding-live-row-active {
          padding: 4px 0 4px 13px;
          border-left: 3px solid #5ab3ff;
        }
        .onboarding-live-pulse {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #5ab3ff;
          flex-shrink: 0;
          box-shadow: 0 0 0 0 rgba(90, 179, 255, 0.55);
          animation: onboardingPulse 1.6s ease-out infinite;
        }
        .onboarding-live-app {
          font-size: 14px;
          font-weight: 650;
          color: #f0f4ff;
        }
        .onboarding-live-title {
          font-size: 12px;
          color: rgba(194,198,214,0.5);
          margin-top: 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 44ch;
        }
        .onboarding-live-stat {
          font-size: 20px;
          font-weight: 720;
          color: #f0f4ff;
          min-width: 36px;
        }
        .onboarding-live-label {
          font-size: 13px;
          color: #c2c6d6;
        }
        .onboarding-reassurance {
          font-size: 12px;
          color: rgba(194,198,214,0.5);
          margin: 0;
        }
        .onboarding-skip-link {
          background: none;
          border: none;
          color: rgba(194,198,214,0.5);
          font-size: 12.5px;
          cursor: pointer;
          padding: 0;
          text-align: center;
          transition: color 140ms ease;
        }
        .onboarding-skip-link:hover {
          color: #c2c6d6;
        }
        .onboarding-proof-pending {
          display: grid;
          justify-items: start;
          gap: 10px;
          padding: 12px 0 2px;
        }
        .onboarding-proof-pending .onboarding-breath {
          height: auto;
          justify-content: flex-start;
        }
        .onboarding-proof-pending p {
          margin: 0;
          color: #f0f4ff;
          font-size: 20px;
          line-height: 1.45;
          max-width: 32ch;
        }
        .onboarding-error {
          padding: 12px 14px;
          border-radius: 14px;
          border: 1px solid rgba(248, 113, 113, 0.26);
          background: rgba(248, 113, 113, 0.08);
          color: #fecaca;
          font-size: 13px;
          line-height: 1.6;
        }
        @keyframes onboardingSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes onboardingPulse {
          0% { box-shadow: 0 0 0 0 rgba(125, 191, 255, 0.55); }
          70% { box-shadow: 0 0 0 8px rgba(125, 191, 255, 0); }
          100% { box-shadow: 0 0 0 0 rgba(125, 191, 255, 0); }
        }
        @keyframes onboardingBreath {
          0%, 100% { transform: scale(0.7); opacity: 0.5; }
          50% { transform: scale(1.0); opacity: 1; }
        }
        @keyframes onboardingBeam {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
        @keyframes onboardingBlockIn {
          from { opacity: 0; transform: translateX(-6px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes onboardingMockHighlight {
          0%, 100% { box-shadow: inset 0 0 0 1px rgba(125, 191, 255, 0.35); }
          50% { box-shadow: inset 0 0 0 1px rgba(125, 191, 255, 0.6), 0 0 0 2px rgba(125, 191, 255, 0.18); }
        }
        @keyframes onboardingToggleTease {
          0%, 40% { background: rgba(255, 255, 255, 0.14); }
          50%, 100% { background: #4ac06e; }
          0%, 40% {}
          45% {}
        }
        .onboarding-settings-mock-row-target .onboarding-settings-mock-toggle::after {
          animation: onboardingToggleKnob 2.8s ease-in-out infinite;
        }
        @keyframes onboardingToggleKnob {
          0%, 40% { left: 2px; }
          50%, 100% { left: 13px; }
        }
        @media (max-width: 720px) {
          .onboarding-shell {
            padding: 22px 20px 20px;
            border-radius: 24px;
          }
          .onboarding-title {
            font-size: 26px;
          }
          .onboarding-permission-grid {
            grid-template-columns: minmax(0, 1fr);
          }
          .onboarding-handoff,
          .onboarding-verify {
            grid-template-columns: 1fr;
          }
          .onboarding-handoff-beam,
          .onboarding-breath {
            height: 72px;
          }
        }
      `}</style>
    </div>
  )
}
