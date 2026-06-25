import { useEffect, useMemo, useState } from 'react'
import type { WrappedPeriod, WrappedPeriodFacts, WrappedPeriodNarrative, WrapProviderState } from '@shared/types'
import { ipc } from '../lib/ipc'
import WrapStory from './wrap/WrapStory'
import {
  BuiltScene, HmCountUp, Kicker, MessageScene, Scene, Theme, THEME,
  categoryColor, formatHm, ghostButton, primaryButton, saveShareCard, subtleLine, type ShareCardModel,
} from './wrap/wrapKit'
import { cardSurface, finaleActions } from './DayWrapped'
import { looksLikeRawArtifactLabel } from '../lib/wrappedFacts'

// ─── Weekly / Monthly / Annual Wrapped (DEV-103) ────────────────────────────────
// The wider lens, on the same <WrapStory> engine and visual system as the day
// wrap. Facts come from frozen daily snapshots (briefs-wraps.md §6.1), so the
// headline number and the narrative can never disagree. The AI writes the prose;
// every number is the snapshot total. With no provider connected we show one
// Settings message and nothing else (§7).

const NOUN: Record<WrappedPeriod, string> = { week: 'week', month: 'month', year: 'year' }

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

function CoverScene({ facts, theme }: { facts: WrappedPeriodFacts; theme: Theme }) {
  return (
    <Scene>
      <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.22em', color: theme.accent, margin: '0 0 16px', opacity: 0.9 }}>
        {facts.rangeLabel.toUpperCase()}
      </p>
      <h1 style={{ fontSize: 'clamp(40px, 6vw, 60px)', fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.03em', color: '#fff', margin: 0 }}>
        Your {NOUN[facts.period]}, wrapped
      </h1>
      <p style={{ ...subtleLine, marginTop: 20, fontStyle: 'italic', opacity: 0.9 }}>“{coverTeaser(facts)}”</p>
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 34, letterSpacing: '0.02em' }}>tap to begin ›</p>
    </Scene>
  )
}

function HeadlineScene({ facts, lead, theme }: { facts: WrappedPeriodFacts; lead: string; theme: Theme }) {
  return (
    <Scene>
      <Kicker accent={theme.accent}>{`The ${NOUN[facts.period]}`}</Kicker>
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

function CarryingScene({ line, theme }: { line: string; theme: Theme }) {
  return (
    <Scene>
      <Kicker accent={theme.accent}>Carrying forward</Kicker>
      <h1 style={{ fontSize: 'clamp(30px, 4.6vw, 46px)', fontWeight: 750, lineHeight: 1.2, letterSpacing: '-0.02em', color: '#fff', margin: 0, maxWidth: '22ch' }}>{line}</h1>
    </Scene>
  )
}

function periodShareModel(facts: WrappedPeriodFacts): ShareCardModel {
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
  }
}

function FinaleScene({ facts, theme, onClose, onRestart }: { facts: WrappedPeriodFacts; theme: Theme; onClose: () => void; onRestart: () => void }) {
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
        <button onClick={(e) => { e.stopPropagation(); void saveShareCard(periodShareModel(facts), `daylens-${facts.period}-${facts.anchorDate}.png`).then(setSaved) }} style={primaryButton(theme.accent)}>
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
  const [provider, setProvider] = useState<WrapProviderState | null>(null)
  const [wrap, setWrap] = useState<{ facts: WrappedPeriodFacts; narrative: WrappedPeriodNarrative } | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setWrap(null)
    void (async () => {
      const state = await ipc.ai.getWrapProviderState().catch(() => ({ connected: false, provider: null } as WrapProviderState))
      if (cancelled) return
      setProvider(state)
      if (!state.connected) { setLoaded(true); return }
      const res = await ipc.ai.getWrappedPeriodWrap(period, anchorDate).catch(() => null)
      if (cancelled) return
      setWrap(res)
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [period, anchorDate])

  const scenes: BuiltScene[] = useMemo(() => {
    if (!loaded || !provider) return [{ theme: THEME.rest, render: () => <MessageScene kicker="Wrapped" title="Writing your wrap…" theme={THEME.rest} /> }]
    if (!provider.connected) return [{
      theme: THEME.rest,
      render: () => (
        <MessageScene kicker="Wrapped" title="Connect a provider to see your wrap." theme={THEME.rest}
          body={`Every word in a wrap comes from a real AI call${provider.provider ? ` to ${provider.provider}` : ''}. Connect one in Settings and your wraps start writing themselves.`}>
          <div style={{ display: 'flex', gap: 12, marginTop: 38, pointerEvents: 'all' }}>
            <button onClick={(e) => { e.stopPropagation(); if (onOpenSettings) onOpenSettings(); else onClose() }} style={primaryButton(THEME.rest.accent)}>Open Settings →</button>
            <button onClick={(e) => { e.stopPropagation(); onClose() }} style={ghostButton}>Dismiss</button>
          </div>
        </MessageScene>
      ),
    }]
    if (!wrap || wrap.facts.totalSeconds <= 0) return [{
      theme: THEME.rest,
      render: () => (
        <MessageScene kicker="Wrapped" title="Nothing to wrap yet." body={`Daylens needs a few tracked days before it can tell the story of your ${NOUN[period]}.`} theme={THEME.rest}>
          <div style={{ display: 'flex', gap: 12, marginTop: 38, pointerEvents: 'all' }}>
            <button onClick={(e) => { e.stopPropagation(); onClose() }} style={ghostButton}>Done</button>
          </div>
        </MessageScene>
      ),
    }]

    const { facts, narrative } = wrap
    const out: BuiltScene[] = []
    out.push({ theme: THEME.cover, render: () => <CoverScene facts={facts} theme={THEME.cover} /> })
    out.push({ theme: THEME.headline, render: () => <HeadlineScene facts={facts} lead={narrative.lead} theme={THEME.headline} /> })
    if (cleanThreads(facts).length > 0) {
      out.push({ theme: THEME.did, render: () => <MatteredScene facts={facts} insight={narrative.slides.whatMattered} theme={THEME.did} reduced={reduced} /> })
    }
    if (facts.buckets.length >= 2) {
      out.push({ theme: THEME.shape, render: () => <ShapeScene facts={facts} story={narrative.slides.whereTimeWent} theme={THEME.shape} reduced={reduced} /> })
    }
    if (standoutOf(facts)) {
      out.push({ theme: THEME.standout, render: () => <StandoutScene facts={facts} line={narrative.slides.standout} theme={THEME.standout} /> })
    }
    if (narrative.slides.carrying) {
      out.push({ theme: THEME.thread, render: () => <CarryingScene line={narrative.slides.carrying!} theme={THEME.thread} /> })
    }
    out.push({ theme: THEME.finale, render: (onRestart) => <FinaleScene facts={facts} theme={THEME.finale} onClose={onClose} onRestart={onRestart} /> })
    return out
  }, [loaded, provider, wrap, period, reduced, onClose, onOpenSettings])

  return <WrapStory scenes={scenes} onClose={onClose} />
}
