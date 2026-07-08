import { useEffect, useMemo, useState } from 'react'
import type { WrappedPeriod, WrappedPeriodFacts, WrappedPeriodNarrative, WrapProviderState } from '@shared/types'
import { ipc } from '../lib/ipc'
import { seedFromDate } from '../lib/dayWrapScenes'
import { periodWrapDeckMeta, planPeriodWrapSlides } from '../lib/wrapDeck'
import GeneratingScreen from './wrap/GeneratingScreen'
import WrapDeck from './wrap/WrapDeck'
import { ghostButton, pickPalette, primaryButton, WrapGate } from './wrap/wrapKit'

// ─── Weekly / Monthly / Annual Wrapped ──────────────────────────────────────────
// The wider lens on the same deck engine as the day wrap. Facts come from
// frozen daily snapshots (briefs-wraps.md §6.1) so the headline number and the
// narrative can never disagree; `planPeriodWrapSlides` turns them into 20+
// slides for a real week, the AI writes the prose, WrapDeck plays it. With no
// provider connected we show one Settings message and nothing else (§7).

const NOUN: Record<WrappedPeriod, string> = { week: 'week', month: 'month', year: 'year' }

// ─── Period gating (wrapped.md §3.2) ─────────────────────────────────────────
// This month / this year cannot be generated while the period is open ("still
// being written"); the user browses and opens PREVIOUS ones. This week is
// generatable but labelled a live "week so far".

function pad(n: number): string { return String(n).padStart(2, '0') }
function ymd(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function parseYmd(s: string): Date { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
function weekStart(s: string): string { const d = parseYmd(s); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return ymd(d) }

function periodIsOpen(period: WrappedPeriod, anchor: string): boolean {
  const today = ymd(new Date())
  if (period === 'week') return weekStart(anchor) === weekStart(today)
  if (period === 'month') return anchor.slice(0, 7) === today.slice(0, 7)
  return anchor.slice(0, 4) === today.slice(0, 4)
}

/** A date inside the previous period of the same cadence. */
function previousPeriodAnchor(period: WrappedPeriod, anchor: string): string {
  if (period === 'week') { const d = parseYmd(anchor); d.setDate(d.getDate() - 7); return ymd(d) }
  if (period === 'month') { const d = parseYmd(anchor); d.setDate(1); d.setDate(0); return ymd(d) }
  return `${Number(anchor.slice(0, 4)) - 1}-06-15`
}

export default function PeriodWrapped({
  period, anchorDate, onClose, onOpenSettings,
}: {
  period: WrappedPeriod
  anchorDate: string
  onClose: () => void
  onOpenSettings?: () => void
}) {
  // Internal anchor so "Open last month/year" can browse previous periods
  // without leaving the wrap. Resets when the caller opens a different period.
  const [anchor, setAnchor] = useState(anchorDate)
  useEffect(() => { setAnchor(anchorDate) }, [anchorDate])

  const seed = useMemo(() => seedFromDate(`${period}:${anchor}`), [period, anchor])
  const palette = useMemo(() => pickPalette(seed), [seed])
  // This month / this year are "still being written" and cannot be generated.
  const blockedOpen = (period === 'month' || period === 'year') && periodIsOpen(period, anchor)
  const [provider, setProvider] = useState<WrapProviderState | null>(null)
  const [wrap, setWrap] = useState<{ facts: WrappedPeriodFacts; narrative: WrappedPeriodNarrative } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (blockedOpen) { setLoaded(true); return }
    let cancelled = false
    setLoaded(false)
    setWrap(null)
    void (async () => {
      const state = await ipc.ai.getWrapProviderState().catch(() => ({ connected: false, provider: null } as WrapProviderState))
      if (cancelled) return
      setProvider(state)
      if (!state.connected) { setLoaded(true); return }
      const res = await ipc.ai.getWrappedPeriodWrap(period, anchor, reloadKey > 0).catch(() => null)
      if (cancelled) return
      setWrap(res)
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [period, anchor, blockedOpen, reloadKey])

  // ── Gates ────────────────────────────────────────────────────────────────

  if (blockedOpen) {
    return (
      <WrapGate theme={palette.rest} kicker="Wrapped"
        title={`This ${NOUN[period]} is still being written.`}
        body={`Come back when it's done. You can open last ${NOUN[period]} any time.`}
        onClose={onClose}>
        <div style={{ display: 'flex', gap: 12, marginTop: 38, pointerEvents: 'all' }}>
          <button onClick={() => setAnchor(previousPeriodAnchor(period, anchor))} style={primaryButton(palette.rest.accent)}>Open last {NOUN[period]} →</button>
          <button onClick={onClose} style={ghostButton}>Done</button>
        </div>
      </WrapGate>
    )
  }

  if (!loaded || !provider) {
    return <GeneratingScreen cadence={period} theme={palette.cover} onClose={onClose} />
  }

  if (!provider.connected) {
    return (
      <WrapGate theme={palette.rest} kicker="Wrapped" title="Connect a provider to see your wrap."
        body={`Every word in a wrap comes from a real AI call${provider.provider ? ` to ${provider.provider}` : ''}. Connect one in Settings and your wraps start writing themselves.`}
        onClose={onClose}>
        <div style={{ display: 'flex', gap: 12, marginTop: 38, pointerEvents: 'all' }}>
          <button onClick={() => { if (onOpenSettings) onOpenSettings(); else onClose() }} style={primaryButton(palette.rest.accent)}>Open Settings →</button>
          <button onClick={onClose} style={ghostButton}>Dismiss</button>
        </div>
      </WrapGate>
    )
  }

  if (!wrap || wrap.facts.totalSeconds <= 0) {
    return (
      <WrapGate theme={palette.rest} kicker="Wrapped" title="Nothing to wrap yet."
        body={`Daylens needs a few tracked days before it can tell the story of your ${NOUN[period]}.`}
        onClose={onClose}>
        <div style={{ display: 'flex', gap: 12, marginTop: 38, pointerEvents: 'all' }}>
          <button onClick={onClose} style={ghostButton}>Done</button>
        </div>
      </WrapGate>
    )
  }

  // ── The deck ─────────────────────────────────────────────────────────────

  const { facts, narrative } = wrap
  const slides = planPeriodWrapSlides(facts)
  return (
    <WrapDeck
      slides={slides}
      meta={periodWrapDeckMeta(facts)}
      narrative={{ lines: narrative.lines, question: narrative.question, reflection: narrative.reflection }}
      seed={seed}
      exportStem={`daylens-${facts.period}-${facts.anchorDate}`}
      generatedLabel={narrative.generatedAt ? relativeTime(narrative.generatedAt) : null}
      onRegenerate={() => setReloadKey((k) => k + 1)}
      onClose={onClose}
      ask={({ slideId, slideLine, question, replyingTo }) =>
        ipc.ai.askWrapped({ cadence: facts.period, periodKey: facts.anchorDate, slideId, slideLine, question, replyingTo })}
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
