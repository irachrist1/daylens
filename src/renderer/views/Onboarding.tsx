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


// ── The tour is a story: one real day, told back to you ─────────────────────
// Every beat auto-animates on entry; advancing is always "forward" (tap the
// scene or Continue), so a tap never means anything but "next".

const STORY_BEATS = [
  { scene: 'intro', pos: 0, time: '', line: 'Here is one day — the way Daylens tells it back to you.' },
  { scene: 'brief', pos: 0.08, time: '8:14 am', line: 'You open your laptop. Your brief is already written.' },
  { scene: 'apps', pos: 0.22, time: '9:00 am', line: 'You move between Ubiquiti, Terminal, and Photos.' },
  { scene: 'merge', pos: 0.34, time: '11:50 am', line: 'Daylens saw one thing, not three.' },
  { scene: 'detour', pos: 0.46, time: '1:42 pm', line: 'A two-minute peek at X — folded in. Never flagged, never judged.' },
  { scene: 'second', pos: 0.60, time: '4:00 pm', line: 'After lunch you ship the timeline rework. Your day: two clean blocks.' },
  { scene: 'ask', pos: 0.78, time: '9:00 pm', line: 'You wonder — what did I actually get done today?' },
  { scene: 'wrap', pos: 0.86, time: '9:30 pm', line: 'An evening wrap, written fresh for the day you had.' },
  { scene: 'week', pos: 0.95, time: 'Friday', line: 'And your week — Spotify-style. Months and years, too.' },
  { scene: 'yours', pos: 1, time: '', line: 'Wrong name? Rename it — it sticks. And none of this ever left your machine.' },
] as const

const STORY_ANSWER = 'You set up the work network this morning, then shipped the timeline rework after lunch — about 7 hours of focused work. The malaria notebook is still open from yesterday.'

function CountUp({ to, decimals = 0, suffix = '' }: { to: number; decimals?: number; suffix?: string }) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    let current = 0
    const increment = to / 26
    const id = window.setInterval(() => {
      current += increment
      if (current >= to) { current = to; window.clearInterval(id) }
      setValue(current)
    }, 22)
    return () => window.clearInterval(id)
  }, [to])
  return <>{value.toFixed(decimals)}{suffix}</>
}

function StoryBlock({ label, time, tone }: { label: string; time: string; tone: string }) {
  return (
    <div className="onboarding-tour-block onboarding-tour-block-static" data-tone={tone} style={{ minHeight: 52 }}>
      <span className="onboarding-tour-block-row">
        <span className="onboarding-tour-block-label">{label}</span>
        <span className="onboarding-tour-block-time">{time}</span>
      </span>
    </div>
  )
}

function TourStory({ index, name }: { index: number; name: string }) {
  const beat = STORY_BEATS[Math.min(index, STORY_BEATS.length - 1)]
  const [typed, setTyped] = useState('')
  const timers = useRef<number[]>([])

  useEffect(() => {
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
    setTyped('')
    if (beat.scene !== 'ask') return
    let n = 0
    const step = () => {
      n += 2
      setTyped(STORY_ANSWER.slice(0, n))
      if (n < STORY_ANSWER.length) timers.current.push(window.setTimeout(step, 16))
    }
    timers.current.push(window.setTimeout(step, 700))
    return () => {
      timers.current.forEach((id) => window.clearTimeout(id))
      timers.current = []
    }
  }, [beat.scene])

  function scene() {
    switch (beat.scene) {
      case 'brief':
        return (
          <div className="onboarding-tour-notif">
            <div className="onboarding-tour-notif-head"><span className="onboarding-tour-notif-dot" />Daylens · morning brief</div>
            <div className="onboarding-tour-notif-body">Good morning{name ? `, ${name}` : ''}. The malaria notebook was still open yesterday — pick it up?</div>
          </div>
        )
      case 'apps':
        return (
          <div className="onboarding-story-apps">
            {['Ubiquiti', 'Terminal', 'Photos'].map((app, i) => (
              <span key={app} className="onboarding-story-appchip" style={{ animationDelay: `${i * 0.12}s` }}>{app}</span>
            ))}
          </div>
        )
      case 'merge':
        return (
          <div className="onboarding-story-stack">
            <StoryBlock label="Configuring the work network" time="9:00–12:00" tone="a" />
            <div className="onboarding-story-cap">3 apps · 1 block</div>
          </div>
        )
      case 'detour':
        return (
          <div className="onboarding-story-stack">
            <StoryBlock label="Configuring the work network" time="9:00–12:00" tone="a" />
            <div className="onboarding-story-cap"><span className="onboarding-story-pill">X.com · 2 min</span> absorbed — not a new block</div>
          </div>
        )
      case 'second':
        return (
          <div className="onboarding-story-stack">
            <StoryBlock label="Configuring the work network" time="9:00–12:00" tone="a" />
            <StoryBlock label="Shipping the timeline rework" time="4:00–7:00" tone="c" />
          </div>
        )
      case 'ask':
        return (
          <div className="onboarding-tour-chatlog">
            <div className="onboarding-tour-bubble onboarding-tour-bubble-q">What did I get done today?</div>
            {typed === ''
              ? <div className="onboarding-tour-bubble onboarding-tour-bubble-a onboarding-tour-thinking"><span /><span /><span /></div>
              : <div className="onboarding-tour-bubble onboarding-tour-bubble-a">{typed}{typed.length < STORY_ANSWER.length && <span className="onboarding-tour-caret" />}</div>}
          </div>
        )
      case 'wrap':
        return (
          <div className="onboarding-tour-notif">
            <div className="onboarding-tour-notif-head"><span className="onboarding-tour-notif-dot" />Daylens · evening wrap</div>
            <div className="onboarding-tour-notif-body">Two clean blocks, 6h 12m of deep work. You closed out the timeline rework — solid day.</div>
          </div>
        )
      case 'week':
        return (
          <div className="onboarding-tour-stats">
            <div><strong><CountUp to={18} suffix="h" /></strong><span>deep work</span></div>
            <div><strong><CountUp to={23} /></strong><span>sessions</span></div>
            <div><strong><CountUp to={4} /></strong><span>projects</span></div>
          </div>
        )
      case 'yours':
        return (
          <div className="onboarding-story-stack">
            <div className="onboarding-tour-block onboarding-tour-block-static" data-tone="a" style={{ minHeight: 52 }}>
              <span className="onboarding-tour-block-row">
                <span className="onboarding-tour-block-label onboarding-tour-relabel">Q3 board deck</span>
                <span className="onboarding-tour-saved">edited by you</span>
              </span>
            </div>
            <div className="onboarding-tour-privacy">Stays on this device · no scores · no judgment</div>
          </div>
        )
      case 'intro':
      default:
        return (
          <div className="onboarding-story-intro">
            {[0.5, 0.3, 0.42].map((opacity, i) => (
              <div key={i} className="onboarding-story-ghost" style={{ opacity, animationDelay: `${i * 0.12}s` }} />
            ))}
          </div>
        )
    }
  }

  return (
    <div className="onboarding-story">
      <div className="onboarding-daybar" aria-hidden="true">
        <div className="onboarding-daybar-track">
          <div className="onboarding-daybar-fill" style={{ width: `${beat.pos * 100}%` }} />
          <div className="onboarding-daybar-marker" style={{ left: `${beat.pos * 100}%` }} />
        </div>
        <div className="onboarding-daybar-ends"><span>morning</span><span>night</span></div>
      </div>
      <div className="onboarding-story-scene" key={beat.scene}>{scene()}</div>
      <div className="onboarding-story-caption">
        {beat.time && <span className="onboarding-story-time">{beat.time}</span>}
        <span className="onboarding-story-line">{beat.line}</span>
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

  // Escape hatch: the user is never trapped on the permission gate. They can
  // proceed without granting (capture simply has nothing to read until they do)
  // and grant later in Settings. Critically, this also keeps the founder able to
  // test the rest of onboarding when macOS is being stubborn about a grant.
  async function skipPermission() {
    track(ANALYTICS_EVENT.ONBOARDING_STEP_COMPLETED, {
      platform,
      step: 'permission',
      surface: 'onboarding',
    })
    await persistOnboarding('proof', { proofState: 'collecting' })
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
    if (tourIndex < STORY_BEATS.length - 1) {
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
            <StageHeading title="Daylens needs Accessibility to read window titles — no screenshots or video." />
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
                </span>
              </div>
            )}
            <button className="onboarding-skip-link" onClick={() => void skipPermission()}>
              Skip for now — you can grant this later in Settings
            </button>
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
          const isLast = tourIndex >= STORY_BEATS.length - 1
          return (
            <div className="onboarding-screen">
              <div className="onboarding-story-tap" onClick={() => advanceTour()}>
                <TourStory index={tourIndex} name={nameDraft.trim()} />
              </div>
              <div className="onboarding-actions">
                <button className="onboarding-btn-primary" onClick={() => advanceTour()}>
                  {isLast ? 'Make it mine' : tourIndex === 0 ? 'Begin' : 'Continue'}
                </button>
                <span className="onboarding-story-taphint">tap anywhere to continue</span>
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
                border: '1px solid rgba(17,24,39,0.14)', borderRadius: 14,
                background: '#ffffff', color: '#1f2633',
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
                border: `1px solid ${trackingOptIn ? 'rgba(26,111,212,0.5)' : 'rgba(17,24,39,0.12)'}`,
                background: trackingOptIn ? 'rgba(26,111,212,0.08)' : '#fafafa',
                color: '#5c6474',
              }}
            >
              <span style={{
                flexShrink: 0, marginTop: 1, width: 18, height: 18, borderRadius: 5,
                border: `1.5px solid ${trackingOptIn ? '#1a6fd4' : 'rgba(17,24,39,0.3)'}`,
                background: trackingOptIn ? '#1a6fd4' : 'transparent',
                display: 'grid', placeItems: 'center', color: '#ffffff', fontSize: 12, fontWeight: 900,
              }}>{trackingOptIn ? '✓' : ''}</span>
              <span style={{ display: 'grid', gap: 2 }}>
                <span style={{ fontSize: 13.5, fontWeight: 650, color: '#1f2633' }}>Keep private apps and sites out of Daylens</span>
                <span style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.5, color: '#5c6474' }}>
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

        /* Interactive tour */
        .onboarding-tour-block-btn,
        .onboarding-tour-block-static {
          -webkit-app-region: no-drag;
          flex-direction: column;
          align-items: stretch;
          justify-content: center;
          gap: 10px;
          padding: 12px;
          border: none;
          width: 100%;
          text-align: left;
          cursor: pointer;
          overflow: hidden;
          transition: min-height 280ms cubic-bezier(.2,.8,.2,1), background 200ms ease, transform 140ms ease;
        }
        .onboarding-tour-block-static { cursor: default; }
        .onboarding-tour-block-btn:hover { transform: translateY(-1px); }
        .onboarding-tour-block-btn.is-open { box-shadow: inset 0 0 0 1px rgba(125,191,255,0.4); }
        .onboarding-tour-block-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .onboarding-tour-block-label { font-size: 13px; font-weight: 650; color: #f3f7ff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .onboarding-tour-block-time { font-size: 11px; color: rgba(255,255,255,0.55); flex-shrink: 0; font-variant-numeric: tabular-nums; }
        .onboarding-tour-evidence { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; animation: onboardingFadeUp 260ms ease both; }
        .onboarding-tour-evi-chip {
          font-size: 11px; font-weight: 600; color: #eaf1ff;
          padding: 3px 9px; border-radius: 999px;
          background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.14);
        }
        .onboarding-tour-evi-note { font-size: 10.5px; color: rgba(255,255,255,0.6); margin-left: 2px; }
        .onboarding-tour-hint { font-size: 11.5px; color: rgba(194,198,214,0.6); text-align: center; }
        .onboarding-tour-privacy {
          font-size: 11.5px; color: rgba(173,198,255,0.85); text-align: center;
          padding: 8px 12px; border-radius: 10px;
          background: rgba(90,179,255,0.08); border: 1px solid rgba(173,198,255,0.16);
        }
        .onboarding-tour-pencil {
          -webkit-app-region: no-drag;
          flex-shrink: 0; font-size: 11px; font-weight: 700; color: #07090f;
          padding: 4px 10px; border-radius: 999px; border: none; cursor: pointer;
          background: #bcd6ff;
        }
        .onboarding-tour-saved { flex-shrink: 0; font-size: 11px; font-weight: 700; color: #4fdbc8; animation: onboardingFadeUp 240ms ease both; }
        .onboarding-tour-relabel { animation: onboardingFadeUp 260ms ease both; }

        .onboarding-tour-ask { gap: 14px; }
        .onboarding-tour-chatlog { display: grid; gap: 8px; min-height: 96px; align-content: start; }
        .onboarding-tour-ask-empty { font-size: 12.5px; color: rgba(194,198,214,0.6); align-self: center; text-align: center; padding: 24px 0; }
        .onboarding-tour-thinking { display: inline-flex; gap: 5px; align-items: center; width: max-content; }
        .onboarding-tour-thinking span { width: 7px; height: 7px; border-radius: 50%; background: rgba(173,198,255,0.7); animation: onboardingBreath 1.2s ease-in-out infinite; }
        .onboarding-tour-thinking span:nth-child(2) { animation-delay: 0.18s; }
        .onboarding-tour-thinking span:nth-child(3) { animation-delay: 0.36s; }
        .onboarding-tour-caret { display: inline-block; width: 7px; height: 14px; margin-left: 2px; vertical-align: -2px; background: #5ab3ff; border-radius: 1px; animation: onboardingCaret 0.9s steps(1) infinite; }
        .onboarding-tour-followups { display: flex; gap: 8px; animation: onboardingFadeUp 260ms ease both; }
        .onboarding-tour-followup { font-size: 11px; font-weight: 600; color: #c8d6f5; padding: 4px 10px; border-radius: 999px; background: rgba(255,255,255,0.04); border: 1px solid rgba(173,198,255,0.14); }
        .onboarding-tour-chips { display: flex; flex-direction: column; gap: 7px; }
        .onboarding-tour-chip {
          -webkit-app-region: no-drag;
          text-align: left; font-size: 12.5px; font-weight: 550; color: #e7edfb;
          padding: 9px 12px; border-radius: 10px; cursor: pointer;
          background: rgba(255,255,255,0.03); border: 1px solid rgba(173,198,255,0.16);
          transition: border-color 140ms ease, background 140ms ease, transform 120ms ease;
        }
        .onboarding-tour-chip:hover { border-color: rgba(173,198,255,0.4); background: rgba(255,255,255,0.06); }
        .onboarding-tour-chip:active { transform: scale(0.99); }
        .onboarding-tour-chip.is-active { border-color: rgba(90,179,255,0.55); background: rgba(26,111,212,0.16); color: #ffffff; }

        .onboarding-seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 11px; background: rgba(0,0,0,0.28); border: 1px solid rgba(173,198,255,0.12); align-self: center; }
        .onboarding-seg-btn {
          -webkit-app-region: no-drag;
          font-size: 12px; font-weight: 650; color: rgba(194,198,214,0.7);
          padding: 6px 16px; border-radius: 8px; border: none; cursor: pointer; background: transparent;
          transition: background 160ms ease, color 160ms ease;
        }
        .onboarding-seg-btn.on { background: linear-gradient(145deg, #1a6fd4, #5ab3ff); color: #fff; }
        .onboarding-tour-notif, .onboarding-tour-stats { animation: onboardingFadeUp 300ms ease both; }
        @keyframes onboardingFadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes onboardingCaret { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }

        /* Story tour */
        .onboarding-story-tap { cursor: pointer; -webkit-app-region: no-drag; }
        .onboarding-story { display: grid; gap: 18px; }
        .onboarding-daybar { display: grid; gap: 6px; }
        .onboarding-daybar-track { position: relative; height: 4px; border-radius: 999px; background: rgba(255,255,255,0.08); }
        .onboarding-daybar-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; background: linear-gradient(90deg, #f5c662, #5ab3ff 60%, #8a7cff); transition: width 420ms cubic-bezier(.2,.8,.2,1); }
        .onboarding-daybar-marker { position: absolute; top: 50%; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%; background: #eaf1ff; transform: translateY(-50%); box-shadow: 0 0 0 4px rgba(90,179,255,0.25); transition: left 420ms cubic-bezier(.2,.8,.2,1); }
        .onboarding-daybar-ends { display: flex; justify-content: space-between; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(194,198,214,0.45); }
        .onboarding-story-scene { min-height: 150px; display: flex; flex-direction: column; justify-content: center; gap: 10px; animation: onboardingFadeUp 360ms ease both; }
        .onboarding-story-caption { display: grid; gap: 4px; min-height: 52px; }
        .onboarding-story-time { font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #7fb6ff; }
        .onboarding-story-line { margin: 0; font-size: 17px; line-height: 1.5; color: #f0f4ff; max-width: 46ch; }
        .onboarding-story-taphint { font-size: 11px; color: rgba(194,198,214,0.45); }
        .onboarding-story-stack { display: grid; gap: 8px; }
        .onboarding-story-cap { font-size: 11.5px; color: rgba(194,198,214,0.7); display: flex; align-items: center; gap: 7px; }
        .onboarding-story-pill { font-size: 11px; font-weight: 600; color: #eaf1ff; padding: 2px 9px; border-radius: 999px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.14); }
        .onboarding-story-apps { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; padding: 18px 0; }
        .onboarding-story-appchip { font-size: 13px; font-weight: 600; color: #eaf1ff; padding: 10px 16px; border-radius: 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(173,198,255,0.18); animation: onboardingChipFloat 420ms cubic-bezier(.2,.8,.2,1) both; }
        .onboarding-story-intro { display: grid; gap: 8px; padding: 6px 0; }
        .onboarding-story-ghost { height: 26px; border-radius: 9px; background: rgba(255,255,255,0.05); animation: onboardingFadeUp 500ms ease both; }
        @keyframes onboardingChipFloat { from { opacity: 0; transform: translateY(10px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
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
        /* ── Langdock-style light theme + aurora gradient (overrides) ───────── */
        .onboarding-root {
          background:
            radial-gradient(130% 70% at 50% -15%, rgba(123,143,247,0.10), transparent 60%),
            #faf9f7;
          --color-surface: #ffffff;
          --color-surface-low: #fafafa;
          --color-surface-container: #ffffff;
          --color-surface-high: #f3f4f6;
          --color-surface-highest: #e9ebef;
          --color-surface-card: #ffffff;
          --color-border-ghost: rgba(17,24,39,0.12);
          --color-text-primary: #1f2633;
          --color-text-secondary: #5c6474;
          --color-text-tertiary: #8b93a3;
          --color-primary: #1a6fd4;
          --color-primary-contrast: #ffffff;
          --color-accent: #1a6fd4;
          --color-accent-dim: rgba(26,111,212,0.10);
          --color-focus-green: #0f766e;
          --gradient-primary: linear-gradient(135deg, #1a6fd4 0%, #5ab3ff 100%);
        }
        .onboarding-shell {
          position: relative;
          overflow: hidden;
          background: #ffffff;
          border: 1px solid rgba(17,24,39,0.08);
          box-shadow: 0 24px 70px rgba(20,28,48,0.16);
          backdrop-filter: none;
        }
        .onboarding-shell::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 168px;
          background:
            radial-gradient(120% 150% at 0% 0%, #6f86f0 0%, rgba(111,134,240,0) 56%),
            radial-gradient(120% 150% at 100% 0%, #c8a7ef 0%, rgba(200,167,239,0) 58%),
            radial-gradient(130% 130% at 50% 0%, #dfe4ff 0%, rgba(223,228,255,0) 62%);
          filter: blur(24px);
          -webkit-mask-image: linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.4) 55%, transparent 100%);
          mask-image: linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.4) 55%, transparent 100%);
          pointer-events: none;
          z-index: 0;
        }
        .onboarding-shell > * { position: relative; z-index: 1; }
        .onboarding-title, .onboarding-status-label, .onboarding-live-app, .onboarding-live-stat,
        .onboarding-steps-title, .onboarding-summary-value, .onboarding-proof-pending p { color: #1f2633; }
        .onboarding-sub, .onboarding-callout-body, .onboarding-summary-detail, .onboarding-hint,
        .onboarding-steps-body, .onboarding-live-label, .onboarding-status { color: #5c6474; }
        .onboarding-eyebrow, .onboarding-callout-title, .onboarding-summary-label,
        .onboarding-reassurance, .onboarding-status-note, .onboarding-hint-quiet,
        .onboarding-live-title, .onboarding-skip-link { color: #8b93a3; }
        .onboarding-skip-link:hover { color: #5c6474; }
        .onboarding-dot { background: rgba(17,24,39,0.12); }
        .onboarding-dot-done { background: rgba(26,111,212,0.5); }
        .onboarding-back { color: #5c6474; }
        .onboarding-back:hover { color: #1f2633; background: rgba(17,24,39,0.05); }
        .onboarding-btn-secondary { border-color: rgba(17,24,39,0.14); color: #1f2633; }
        .onboarding-btn-secondary:hover:not(:disabled) { border-color: rgba(26,111,212,0.4); }
        .onboarding-status { background: #f6f7f9; border-color: rgba(17,24,39,0.10); }
        .onboarding-name-field input { background: #ffffff; border-color: rgba(17,24,39,0.14); color: #1f2633; }
        .onboarding-name-field input::placeholder { color: #a2a8b4; }
        .onboarding-goal-chip { background: #ffffff; border-color: rgba(17,24,39,0.12); color: #1f2633; }
        .onboarding-goal-chip:hover:not(.onboarding-goal-chip-selected) { border-color: rgba(26,111,212,0.35); background: #f6f8fc; }
        .onboarding-goal-chip-selected { border-color: rgba(26,111,212,0.6); background: rgba(26,111,212,0.10); color: #14467f; }
        .onboarding-summary-tile, .onboarding-goal-card { background: #fafafa; border-color: rgba(17,24,39,0.10); }
        .onboarding-summary-tile-highlight { border-color: rgba(26,111,212,0.4); background: linear-gradient(180deg, rgba(26,111,212,0.07), rgba(90,179,255,0.04)); box-shadow: 0 8px 26px rgba(26,111,212,0.12); }
        .onboarding-daybar-track { background: rgba(17,24,39,0.08); }
        .onboarding-daybar-marker { background: #1a6fd4; box-shadow: 0 0 0 4px rgba(26,111,212,0.18); }
        .onboarding-daybar-ends, .onboarding-story-taphint, .onboarding-story-cap { color: #8b93a3; }
        .onboarding-story-line { color: #1f2633; }
        .onboarding-story-time { color: #1a6fd4; }
        .onboarding-story-pill { color: #1f2633; background: rgba(17,24,39,0.05); border-color: rgba(17,24,39,0.12); }
        .onboarding-story-appchip { color: #1f2633; background: #ffffff; border-color: rgba(17,24,39,0.12); }
        .onboarding-story-ghost { background: rgba(17,24,39,0.05); }
        .onboarding-tour-block { color: #1f2633; box-shadow: inset 0 0 0 1px rgba(17,24,39,0.04); }
        .onboarding-tour-block[data-tone="a"] { background: linear-gradient(135deg, rgba(123,143,247,0.22), rgba(90,179,255,0.16)); }
        .onboarding-tour-block[data-tone="b"] { background: #f3f4f6; color: #5c6474; }
        .onboarding-tour-block[data-tone="c"] { background: linear-gradient(135deg, rgba(178,160,255,0.22), rgba(123,143,247,0.16)); }
        .onboarding-tour-block-label { color: #1f2633; }
        .onboarding-tour-block-time { color: #8b93a3; }
        .onboarding-tour-notif { background: #fafafa; border-color: rgba(17,24,39,0.10); }
        .onboarding-tour-notif-head { color: #8b93a3; }
        .onboarding-tour-notif-body { color: #1f2633; }
        .onboarding-tour-bubble-a { background: #f3f4f6; color: #1f2633; border-color: rgba(17,24,39,0.08); }
        .onboarding-tour-stats > div { background: #fafafa; border-color: rgba(17,24,39,0.10); }
        .onboarding-tour-stats strong { color: #1f2633; }
        .onboarding-tour-stats span { color: #8b93a3; }
        .onboarding-tour-privacy { color: #14467f; background: rgba(26,111,212,0.07); border-color: rgba(26,111,212,0.16); }
        .onboarding-tour-hint { color: #8b93a3; }
        .onboarding-tour-saved { color: #0f766e; }
        .onboarding-tour-thinking span { background: rgba(26,111,212,0.55); }
        .onboarding-tour-caret { background: #1a6fd4; }
        .onboarding-settings-mock { background: #ffffff; border-color: rgba(17,24,39,0.10); box-shadow: 0 18px 44px rgba(20,28,48,0.12); }
        .onboarding-settings-mock-header { background: #f6f7f9; border-bottom-color: rgba(17,24,39,0.06); }
        .onboarding-settings-mock-title { color: #5c6474; }
        .onboarding-settings-mock-app { color: #1f2633; }
        .onboarding-settings-mock-badge { color: #14467f; }
        .onboarding-settings-mock-toggle.off { background: rgba(17,24,39,0.18); }
        .onboarding-settings-mock-hint { color: #8b93a3; border-top-color: rgba(17,24,39,0.06); }
        .onboarding-handoff, .onboarding-verify, .onboarding-callout, .onboarding-proof-card { background: #fafafa; border-color: rgba(17,24,39,0.10); }

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
