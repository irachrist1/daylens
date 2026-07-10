import { useEffect, useMemo, useState } from 'react'
import type { AIWrappedNarrative, WrapPreflightResult, WrapProviderState } from '@shared/types'
import type { DayTimelinePayload } from '@shared/types'
import { ipc } from '../lib/ipc'
import { todayString, shiftDateString } from '../lib/format'
import { buildDayWrapFacts } from '../lib/dayWrapScenes'
import { dayWrapDeckMeta, planDayWrapSlides } from '../lib/wrapDeck'
import GeneratingScreen from './wrap/GeneratingScreen'
import WrapDeck from './wrap/WrapDeck'
import { formatHm, ghostButton, pickPalette, primaryButton, WrapGate } from './wrap/wrapKit'

// ─── Daily Wrapped ──────────────────────────────────────────────────────────────
// The deck-era rewrite. `planDayWrapSlides` computes the slides from ONE
// deterministic facts object (the same object the main process narrates from),
// the AI writes one line per slide plus a curious question and the closing
// reflection, and <WrapDeck> plays it: staged reveals, ask-anything on every
// slide, export-everything on the finale. A first open shows the cinematic
// generating screen while the AI assembles the deck — never a broken shell.

type WrapMode = 'today' | 'yesterday' | 'past'

const WORK_THRESHOLD_SECONDS = 2 * 60 * 60

function resolveMode(date: string): WrapMode {
  const today = todayString()
  if (date === today) return 'today'
  if (date === shiftDateString(today, -1)) return 'yesterday'
  return 'past'
}

// The under-threshold line for the live day (the real voice comes from the AI
// once generated; this is the honest deterministic floor). Names the real
// number, never dares the user.
function underThresholdLine(workSeconds: number): string {
  const m = Math.max(1, Math.round(workSeconds / 60))
  const t = workSeconds >= 60 * 60 ? formatHm(workSeconds) : `${m} minutes`
  return `${t} of work so far. Give the day a little more and come back.`
}

export default function DayWrapped({
  data, onClose, onOpenReport, onOpenSettings,
}: {
  data: DayTimelinePayload
  threadId?: number | null
  artifactId?: number | null
  onClose: () => void
  onOpenReport: () => void
  onOpenSettings?: () => void
  userName?: string | null
}) {
  const facts = useMemo(() => buildDayWrapFacts(data), [data])
  const mode = useMemo(() => resolveMode(data.date), [data.date])
  const palette = useMemo(() => pickPalette(facts.seed), [facts.seed])

  const [provider, setProvider] = useState<WrapProviderState | null>(null)
  const [narrative, setNarrative] = useState<AIWrappedNarrative | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [generatedAt, setGeneratedAt] = useState<number | null>(null)
  // The 2h tracked-work gate applies to the LIVE day only. A finished day is
  // always available. "Generate anyway" is the quiet escape hatch.
  const underThreshold = mode === 'today' && facts.workSeconds < WORK_THRESHOLD_SECONDS && facts.quality !== 'empty'
  const [forced, setForced] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const gated = underThreshold && !forced

  // Pre-flight data quality gate (wrapped Stage 0.4): before the FIRST
  // generation, surface honest, specific warnings about thin data. One tap
  // proceeds; an already-generated wrap opens directly, no nagging. The
  // live-day lowWork warning is owned by the 2h threshold gate above.
  const [preflight, setPreflight] = useState<WrapPreflightResult | null>(null)
  const [preflightAck, setPreflightAck] = useState(false)
  const preflightWarnings = useMemo(() => {
    if (!preflight) return []
    return preflight.warnings.filter((w) => !(w.kind === 'lowWork' && mode === 'today'))
  }, [preflight, mode])

  useEffect(() => { setPreflightAck(false); setPreflight(null) }, [data.date])

  useEffect(() => {
    if (gated) { setLoaded(true); return }
    let cancelled = false
    setLoaded(false)
    setNarrative(null)
    void (async () => {
      const state = await ipc.ai.getWrapProviderState().catch(() => ({ connected: false, provider: null } as WrapProviderState))
      if (cancelled) return
      setProvider(state)
      if (!state.connected) { setLoaded(true); return }
      const check = await ipc.ai.getWrapPreflight(data.date).catch(() => null)
      if (cancelled) return
      setPreflight(check)
      const warnings = check
        ? check.warnings.filter((w) => !(w.kind === 'lowWork' && mode === 'today'))
        : []
      if (check && !check.hasStoredWrap && warnings.length > 0 && !preflightAck && reloadKey === 0) {
        setLoaded(true)
        return
      }
      const day = await ipc.ai.getWrappedNarrative(data.date, reloadKey > 0).catch(() => null)
      if (cancelled) return
      setNarrative(day ?? null)
      // Show when the wrap was actually generated (persisted), not "just now" on
      // every open — only fall back to now for a transient, un-persisted result.
      setGeneratedAt(day?.generatedAt ?? Date.now())
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [data.date, gated, reloadKey, preflightAck, mode])

  // ── Gates, in priority order ─────────────────────────────────────────────

  if (gated) {
    return (
      <WrapGate theme={palette.rest} kicker="Today so far" title={underThresholdLine(facts.workSeconds)} onClose={onClose}>
        <div style={{ display: 'flex', gap: 12, marginTop: 38, pointerEvents: 'all' }}>
          <button onClick={() => setForced(true)} style={ghostButton}>Generate anyway</button>
          <button onClick={onClose} style={ghostButton}>Not yet</button>
        </div>
      </WrapGate>
    )
  }

  // The first-open fix: a real generating screen while the AI assembles the
  // deck, then the first slide animates in.
  if (!loaded || !provider) {
    return <GeneratingScreen cadence="day" theme={palette.cover} onClose={onClose} />
  }

  if (!provider.connected) {
    return (
      <WrapGate theme={palette.rest} kicker="Wrapped" title="No provider connected, so there's no wrap."
        body="Connect one in Settings and your day gets written up." onClose={onClose}>
        <div style={{ display: 'flex', gap: 12, marginTop: 38, pointerEvents: 'all' }}>
          <button onClick={() => { if (onOpenSettings) onOpenSettings(); else onClose() }} style={primaryButton(palette.rest.accent)}>Open Settings →</button>
          <button onClick={onClose} style={ghostButton}>Dismiss</button>
        </div>
      </WrapGate>
    )
  }

  // The pre-flight warning: what's thin about the data, in real numbers, with
  // a one-tap way through. Shown only before the first generation.
  if (preflight && !preflight.hasStoredWrap && !preflightAck && preflightWarnings.length > 0 && !narrative) {
    return (
      <WrapGate theme={palette.rest} kicker="Before the wrap" title="Heads up about this day's data." onClose={onClose}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22, maxWidth: 520, pointerEvents: 'all' }}>
          {preflightWarnings.map((w) => (
            <p key={w.kind} style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'rgba(255,255,255,0.78)', textAlign: 'left' }}>
              {w.message}
            </p>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 34, pointerEvents: 'all' }}>
          <button onClick={() => setPreflightAck(true)} style={primaryButton(palette.rest.accent)}>Generate anyway</button>
          <button onClick={onClose} style={ghostButton}>Not now</button>
        </div>
      </WrapGate>
    )
  }

  if (facts.quality === 'empty' || facts.activeSeconds <= 0 || !narrative) {
    return (
      <WrapGate theme={palette.rest} kicker="Wrapped" title="A quiet one."
        body="Not much tracked yet. Come back once the day has more in it." onClose={onClose}>
        <div style={{ display: 'flex', gap: 12, marginTop: 38, pointerEvents: 'all' }}>
          <button onClick={onClose} style={ghostButton}>Done</button>
        </div>
      </WrapGate>
    )
  }

  // ── The deck ─────────────────────────────────────────────────────────────

  // The coverage card's inputs: browser presence from the payload itself,
  // connector presence from preflight (the same resolver the writer used).
  const slides = planDayWrapSlides(facts, {
    browser: data.websites.length > 0,
    connectors: preflight?.sources ?? null,
  })
  const meta = dayWrapDeckMeta(facts)
  return (
    <WrapDeck
      slides={slides}
      meta={{ ...meta, title: mode === 'yesterday' ? 'Yesterday, wrapped' : meta.title }}
      narrative={{ lines: narrative.lines, question: narrative.question, reflection: narrative.reflection }}
      seed={facts.seed}
      exportStem={`daylens-${facts.date}`}
      generatedLabel={generatedAt ? relativeTime(generatedAt) : null}
      onRegenerate={() => setReloadKey((k) => k + 1)}
      onClose={onClose}
      ask={({ slideId, slideLine, question, replyingTo }) =>
        ipc.ai.askWrapped({ cadence: 'day', periodKey: facts.date, slideId, slideLine, question, replyingTo })}
      finaleExtra={{ label: mode === 'yesterday' ? 'Continue your day' : 'Open timeline', onClick: onOpenReport }}
    />
  )
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
