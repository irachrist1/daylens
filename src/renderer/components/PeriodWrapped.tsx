import { useEffect, useMemo, useState } from 'react'
import type { WrappedPeriod, WrappedPeriodFacts, WrappedPeriodNarrative, WrapProviderState } from '@shared/types'
import { ipc } from '../lib/ipc'
import WrapStory from './wrap/WrapStory'
import {
  BuiltScene, HmCountUp, Kicker, MessageScene, Scene, Theme,
  categoryColor, formatHm, ghostButton, pickPalette, primaryButton, saveShareCard,
  shareGradient, subtleLine, type ShareCardModel, type WrapPalette,
} from './wrap/wrapKit'
import { cardSurface, finaleActions } from './DayWrapped'
import { seedFromDate } from '../lib/dayWrapScenes'
import { looksLikeRawArtifactLabel } from '../lib/wrappedFacts'

// ─── Weekly / Monthly / Annual Wrapped (DEV-103) ────────────────────────────────
// The wider lens, on the same <WrapStory> engine and visual system as the day
// wrap. Facts come from frozen daily snapshots (briefs-wraps.md §6.1), so the
// headline number and the narrative can never disagree. The AI writes the prose;
// every number is the snapshot total. With no provider connected we show one
// Settings message and nothing else (§7).

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

function coverTeaser(facts: WrappedPeriodFacts): string {
  const days = facts.daysWithActivity
  if (facts.period === 'week') return days >= 6 ? 'A full week.' : days >= 3 ? 'A few good days.' : 'A light week.'
  if (facts.period === 'month') return 'Four weeks, one story.'
  return 'A whole year of days.'
}

function caption(facts: WrappedPeriodFacts): string {
  const d = facts.daysWithActivity
  return `across ${d} active ${d === 1 ? 'day' : 'days'}`
}

/** Threads named for the work; fold anything that still reads like a raw label. */
function cleanThreads(facts: WrappedPeriodFacts): WrappedPeriodFacts['threads'] {
  return facts.threads.filter((t) => t.subject && !looksLikeRawArtifactLabel(t.subject))
}

function standoutOf(facts: WrappedPeriodFacts): { seconds: number; caption: string } | null {
  if (facts.longestStretch) {
    return {
      seconds: facts.longestStretch.seconds,
      caption: `your longest unbroken stretch, on ${facts.longestStretch.dayLabel}`,
    }
  }
  if (facts.busiestDay) {
    return {
      seconds: facts.busiestDay.totalSeconds,
      caption: `${facts.busiestDay.dayLabel} carried the most`,
    }
  }
  return null
}

// ─── Scenes ─────────────────────────────────────────────────────────────────────

function CoverScene({ facts, live, theme }: { facts: WrappedPeriodFacts; live?: boolean; theme: Theme }) {
  return (
    <Scene>
      <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.22em', color: theme.accent, margin: '0 0 16px', opacity: 0.9 }}>
        {facts.rangeLabel.toUpperCase()}
      </p>
      <h1 style={{ fontSize: 'clamp(40px, 6vw, 60px)', fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.03em', color: '#fff', margin: 0 }}>
        {live ? `Your ${NOUN[facts.period]} so far` : `Your ${NOUN[facts.period]}, wrapped`}
      </h1>
      <p style={{ ...subtleLine, marginTop: 20, fontStyle: 'italic', opacity: 0.9 }}>“{coverTeaser(facts)}”</p>
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 34, letterSpacing: '0.02em' }}>tap to begin ›</p>
    </Scene>
  )
}

function HeadlineScene({ facts, lead, live, theme }: { facts: WrappedPeriodFacts; lead: string; live?: boolean; theme: Theme }) {
  return (
    <Scene>
      <Kicker accent={theme.accent}>{live ? `The ${NOUN[facts.period]} so far` : `The ${NOUN[facts.period]}`}</Kicker>
      <HmCountUp seconds={facts.totalSeconds} style={{ fontSize: 'clamp(66px, 15vw, 124px)', fontWeight: 900, lineHeight: 0.95, letterSpacing: '-0.045em', color: theme.accent }} />
      <p style={{ ...subtleLine, marginTop: 30 }}>{lead}</p>
    </Scene>
  )
}

function ThreadRow({ rank, subject, seconds, daysActive, max, accent, reduced }: { rank: number; subject: string; seconds: number; daysActive: number; max: number; accent: string; reduced: boolean }) {
  const [fill, setFill] = useState(reduced ? 1 : 0)
  useEffect(() => {
    if (reduced) { setFill(1); return }
    const id = setTimeout(() => setFill(1), 120 + rank * 90)
    return () => clearTimeout(id)
  }, [reduced, rank])
  const pct = Math.round((seconds / max) * 100)
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: accent, width: 18, textAlign: 'right', flexShrink: 0 }}>{rank}</span>
        <span style={{ fontSize: 'clamp(17px, 2.4vw, 21px)', fontWeight: 650, color: '#fff', flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subject}</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.62)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {formatHm(seconds)}{daysActive > 1 ? <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}> · {daysActive}d</span> : null}
        </span>
      </div>
      <div style={{ marginLeft: 32, height: 5, background: 'rgba(255,255,255,0.09)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${fill * pct}%`, height: '100%', background: accent, borderRadius: 3, transition: reduced ? 'none' : 'width 1s cubic-bezier(0.16,1,0.3,1)' }} />
      </div>
    </div>
  )
}

function MatteredScene({ facts, insight, theme, reduced }: { facts: WrappedPeriodFacts; insight: string | null; theme: Theme; reduced: boolean }) {
  const threads = cleanThreads(facts).slice(0, 4)
  const max = threads[0]?.seconds ?? 1
  return (
    <Scene>
      <Kicker accent={theme.accent}>What mattered</Kicker>
      <div style={{ width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {threads.map((t, i) => (
          <ThreadRow key={t.subject} rank={i + 1} subject={t.subject} seconds={t.seconds} daysActive={t.daysActive} max={max} accent={theme.accent} reduced={reduced} />
        ))}
      </div>
      {insight && <p style={{ ...subtleLine, fontSize: 'clamp(16px,2.4vw,21px)', marginTop: 30 }}>{insight}</p>}
    </Scene>
  )
}

function ShapeScene({ facts, story, theme, reduced }: { facts: WrappedPeriodFacts; story: string | null; theme: Theme; reduced: boolean }) {
  const max = Math.max(...facts.buckets.map((b) => b.totalSeconds), 1)
  const [grown, setGrown] = useState(reduced)
  useEffect(() => {
    if (reduced) { setGrown(true); return }
    const id = setTimeout(() => setGrown(true), 140)
    return () => clearTimeout(id)
  }, [reduced])
  const many = facts.buckets.length > 8
  return (
    <Scene>
      <Kicker accent={theme.accent}>The shape of your {NOUN[facts.period]}</Kicker>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: many ? 6 : 10, height: 150, width: '100%', maxWidth: 560 }}>
        {facts.buckets.map((b, i) => {
          const h = grown ? Math.max(4, Math.round((b.totalSeconds / max) * 130)) : 4
          const isPeak = b.totalSeconds === max && max > 1
          return (
            <div key={`${b.label}-${i}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1 }}>
              <div style={{ width: '100%', height: h, borderRadius: 5, background: categoryColor(b.dominantWorkCategory), opacity: isPeak ? 1 : 0.42, boxShadow: isPeak ? `0 0 16px ${theme.glow}` : 'none', transition: reduced ? 'none' : `height 0.9s ${i * 0.05}s cubic-bezier(0.16,1,0.3,1)` }} />
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.46)', fontWeight: isPeak ? 700 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                {many ? b.label.slice(0, 1) : b.label.replace('Week of ', '')}
              </span>
            </div>
          )
        })}
      </div>
      {story && <p style={{ ...subtleLine, marginTop: 28 }}>{story}</p>}
    </Scene>
  )
}

function StandoutScene({ facts, line, theme }: { facts: WrappedPeriodFacts; line: string | null; theme: Theme }) {
  const s = standoutOf(facts)!
  return (
    <Scene>
      <Kicker accent={theme.accent}>A standout</Kicker>
      <HmCountUp seconds={s.seconds} style={{ fontSize: 'clamp(64px, 13vw, 112px)', fontWeight: 900, lineHeight: 0.95, letterSpacing: '-0.04em', color: theme.accent }} />
      <p style={{ ...subtleLine, marginTop: 26 }}>{line ?? s.caption}</p>
    </Scene>
  )
}

// The nitty-gritty: which apps and sites actually held the time (wrapped.md
// §5.2-5.4). Looks back, never ahead, so it replaces the banned "carrying
// forward" card outright.
function DistributionScene({ facts, line, theme, reduced }: { facts: WrappedPeriodFacts; line: string | null; theme: Theme; reduced: boolean }) {
  const apps = facts.topApps.slice(0, 5)
  const max = apps[0]?.seconds ?? 1
  return (
    <Scene>
      <Kicker accent={theme.accent}>Where the time actually went</Kicker>
      <div style={{ width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 13 }}>
        {apps.map((app, i) => (
          <PeriodDistRow key={app.appName} name={app.appName} seconds={app.seconds} max={max} accent={theme.accent} reduced={reduced} rank={i} />
        ))}
      </div>
      {facts.leisureSurfaces.length > 0 && (
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginTop: 18 }}>
          on the side: {facts.leisureSurfaces.slice(0, 3).join(', ')}
        </p>
      )}
      {line && <p style={{ ...subtleLine, fontSize: 'clamp(16px,2.4vw,21px)', marginTop: 20 }}>{line}</p>}
    </Scene>
  )
}

function PeriodDistRow({ name, seconds, max, accent, reduced, rank }: { name: string; seconds: number; max: number; accent: string; reduced: boolean; rank: number }) {
  const [fill, setFill] = useState(reduced ? 1 : 0)
  useEffect(() => {
    if (reduced) { setFill(1); return }
    const id = setTimeout(() => setFill(1), 120 + rank * 80)
    return () => clearTimeout(id)
  }, [reduced, rank])
  const pct = Math.round((seconds / max) * 100)
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 'clamp(15px, 2.2vw, 19px)', fontWeight: 650, color: '#fff', flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap' }}>{formatHm(seconds)}</span>
      </div>
      <div style={{ height: 5, background: 'rgba(255,255,255,0.09)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${fill * pct}%`, height: '100%', background: accent, borderRadius: 3, transition: reduced ? 'none' : 'width 0.9s cubic-bezier(0.16,1,0.3,1)' }} />
      </div>
    </div>
  )
}

function periodShareModel(facts: WrappedPeriodFacts, seed: number): ShareCardModel {
  const threads = cleanThreads(facts).slice(0, 3)
  const s = standoutOf(facts)
  return {
    eyebrow: facts.rangeLabel.toUpperCase(),
    headline: formatHm(facts.totalSeconds),
    caption: caption(facts),
    rows: threads.map((t) => ({ name: t.subject, value: formatHm(t.seconds) })),
    statLabel: s ? 'Longest stretch' : undefined,
    statValue: s ? formatHm(s.seconds) : undefined,
    footer: `${NOUN[facts.period]}, wrapped by Daylens`,
    ...shareGradient(seed),
  }
}

function FinaleScene({ facts, seed, theme, onClose, onRestart }: { facts: WrappedPeriodFacts; seed: number; theme: Theme; onClose: () => void; onRestart: () => void }) {
  const [saved, setSaved] = useState(false)
  const threads = cleanThreads(facts).slice(0, 3)
  const s = standoutOf(facts)
  return (
    <Scene>
      <div style={cardSurface}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.18em', color: theme.accent }}>DAYLENS</span>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.55)' }}>{facts.rangeLabel}</span>
        </div>
        <div style={{ fontSize: 56, fontWeight: 900, letterSpacing: '-0.045em', color: '#fff', lineHeight: 1 }}>{formatHm(facts.totalSeconds)}</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 4, marginBottom: 20 }}>{caption(facts)}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {threads.map((t, i) => (
            <div key={t.subject} style={{ display: 'flex', alignItems: 'baseline', gap: 11 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: theme.accent, width: 14, flexShrink: 0 }}>{i + 1}</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</span>
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap' }}>{formatHm(t.seconds)}</span>
            </div>
          ))}
        </div>
        {s && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.12)', fontSize: 14, color: 'rgba(255,255,255,0.72)' }}>
            Longest stretch: <span style={{ color: '#fff', fontWeight: 700 }}>{formatHm(s.seconds)}</span>
          </div>
        )}
      </div>
      <div style={finaleActions}>
        <button onClick={(e) => { e.stopPropagation(); void saveShareCard(periodShareModel(facts, seed), `daylens-${facts.period}-${facts.anchorDate}.png`).then(setSaved) }} style={primaryButton(theme.accent)}>
          {saved ? 'Saved ✓' : 'Save image'}
        </button>
        <button onClick={(e) => { e.stopPropagation(); onRestart() }} style={ghostButton} aria-label="Replay">↺</button>
        <button onClick={(e) => { e.stopPropagation(); onClose() }} style={ghostButton}>Done</button>
      </div>
    </Scene>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────────

export default function PeriodWrapped({
  period, anchorDate, onClose, onOpenSettings,
}: {
  period: WrappedPeriod
  anchorDate: string
  onClose: () => void
  onOpenSettings?: () => void
}) {
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // Internal anchor so "Open last month/year" can browse previous periods
  // without leaving the wrap. Resets when the caller opens a different period.
  const [anchor, setAnchor] = useState(anchorDate)
  useEffect(() => { setAnchor(anchorDate) }, [anchorDate])

  const seed = useMemo(() => seedFromDate(`${period}:${anchor}`), [period, anchor])
  const palette = useMemo<WrapPalette>(() => pickPalette(seed), [seed])
  // This month / this year are "still being written" and cannot be generated.
  const blockedOpen = (period === 'month' || period === 'year') && periodIsOpen(period, anchor)
  const liveWeek = period === 'week' && periodIsOpen(period, anchor)
  const [provider, setProvider] = useState<WrapProviderState | null>(null)
  const [wrap, setWrap] = useState<{ facts: WrappedPeriodFacts; narrative: WrappedPeriodNarrative } | null>(null)
  const [loaded, setLoaded] = useState(false)

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
      const res = await ipc.ai.getWrappedPeriodWrap(period, anchor).catch(() => null)
      if (cancelled) return
      setWrap(res)
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [period, anchor, blockedOpen])

  const scenes: BuiltScene[] = useMemo(() => {
    // This month / this year is still being written: no generation, but the user
    // can open the previous one (wrapped.md §3.2).
    if (blockedOpen) return [{
      theme: palette.rest,
      render: () => (
        <MessageScene
          kicker="Wrapped"
          title={`This ${NOUN[period]} is still being written.`}
          body={`Come back when it's done. You can open last ${NOUN[period]} any time.`}
          theme={palette.rest}>
          <div style={{ display: 'flex', gap: 12, marginTop: 38, pointerEvents: 'all' }}>
            <button onClick={(e) => { e.stopPropagation(); setAnchor(previousPeriodAnchor(period, anchor)) }} style={primaryButton(palette.rest.accent)}>Open last {NOUN[period]} →</button>
            <button onClick={(e) => { e.stopPropagation(); onClose() }} style={ghostButton}>Done</button>
          </div>
        </MessageScene>
      ),
    }]
    if (!loaded || !provider) return [{ theme: palette.rest, render: () => <MessageScene kicker="Wrapped" title="Writing your wrap…" theme={palette.rest} /> }]
    if (!provider.connected) return [{
      theme: palette.rest,
      render: () => (
        <MessageScene kicker="Wrapped" title="Connect a provider to see your wrap." theme={palette.rest}
          body={`Every word in a wrap comes from a real AI call${provider.provider ? ` to ${provider.provider}` : ''}. Connect one in Settings and your wraps start writing themselves.`}>
          <div style={{ display: 'flex', gap: 12, marginTop: 38, pointerEvents: 'all' }}>
            <button onClick={(e) => { e.stopPropagation(); if (onOpenSettings) onOpenSettings(); else onClose() }} style={primaryButton(palette.rest.accent)}>Open Settings →</button>
            <button onClick={(e) => { e.stopPropagation(); onClose() }} style={ghostButton}>Dismiss</button>
          </div>
        </MessageScene>
      ),
    }]
    if (!wrap || wrap.facts.totalSeconds <= 0) return [{
      theme: palette.rest,
      render: () => (
        <MessageScene kicker="Wrapped" title="Nothing to wrap yet." body={`Daylens needs a few tracked days before it can tell the story of your ${NOUN[period]}.`} theme={palette.rest}>
          <div style={{ display: 'flex', gap: 12, marginTop: 38, pointerEvents: 'all' }}>
            <button onClick={(e) => { e.stopPropagation(); onClose() }} style={ghostButton}>Done</button>
          </div>
        </MessageScene>
      ),
    }]

    const { facts, narrative } = wrap
    const share = periodShareModel(facts, seed)
    const stem = `daylens-${facts.period}-${facts.anchorDate}`
    const out: BuiltScene[] = []
    out.push({ theme: palette.cover, render: () => <CoverScene facts={facts} live={liveWeek} theme={palette.cover} /> })
    out.push({ theme: palette.headline, render: () => <HeadlineScene facts={facts} lead={narrative.lead} live={liveWeek} theme={palette.headline} />, share, shareName: `${stem}-headline` })
    if (cleanThreads(facts).length > 0) {
      out.push({ theme: palette.did, render: () => <MatteredScene facts={facts} insight={narrative.slides.whatMattered} theme={palette.did} reduced={reduced} />, share, shareName: `${stem}-mattered` })
    }
    if (facts.buckets.length >= 2) {
      out.push({ theme: palette.shape, render: () => <ShapeScene facts={facts} story={narrative.slides.whereTimeWent} theme={palette.shape} reduced={reduced} /> })
    }
    if (standoutOf(facts)) {
      out.push({ theme: palette.standout, render: () => <StandoutScene facts={facts} line={narrative.slides.standout} theme={palette.standout} /> })
    }
    // The nitty-gritty distribution (replaces the banned carryover card).
    if (facts.topApps.length > 0) {
      out.push({ theme: palette.thread, render: () => <DistributionScene facts={facts} line={narrative.slides.distribution} theme={palette.thread} reduced={reduced} />, share, shareName: `${stem}-distribution` })
    }
    out.push({ theme: palette.finale, render: (onRestart) => <FinaleScene facts={facts} seed={seed} theme={palette.finale} onClose={onClose} onRestart={onRestart} />, share, shareName: `${stem}-finale` })
    return out
  }, [blockedOpen, liveWeek, anchor, loaded, provider, wrap, period, seed, palette, reduced, onClose, onOpenSettings])

  return <WrapStory scenes={scenes} onClose={onClose} />
}
