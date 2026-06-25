import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AIWrappedNarrative, DayTimelinePayload, WrapProviderState } from '@shared/types'
import { ipc } from '../lib/ipc'
import { todayString, shiftDateString } from '../lib/format'
import Mascot from './Mascot'
import WrapStory from './wrap/WrapStory'
import {
  BuiltScene, HmCountUp, Kicker, MessageScene, Scene, Theme, THEME,
  categoryColor, formatHm, ghostButton, primaryButton, saveShareCard, subtleLine, type ShareCardModel,
} from './wrap/wrapKit'
import {
  buildDayWrapFacts, type DayWrapFacts, type RibbonSegment, type WrapActivity,
} from '../lib/dayWrapScenes'

// ─── Daily Wrapped (DEV-114) ───────────────────────────────────────────────────
// Spotify Wrapped, for one day, on the shared <WrapStory> engine. Two modes —
// today's (sign-off) and yesterday's (catch-up) — share scenes, data, and the
// visual system, and differ only in framing copy, the cover, and the finale CTA.
//
// Every number comes from ONE deterministic facts object (`buildDayWrapFacts`);
// the AI narrative only writes prose on top, and is rejected outright when it
// contradicts a number (briefs-wraps.md §8). With no provider connected we show
// one Settings message and nothing else (§7).

type WrapMode = 'today' | 'yesterday' | 'past'

function resolveMode(date: string): WrapMode {
  const today = todayString()
  if (date === today) return 'today'
  if (date === shiftDateString(today, -1)) return 'yesterday'
  return 'past'
}

function coverTitle(mode: WrapMode, inProgress: boolean): string {
  if (mode === 'today') return inProgress ? 'Today so far' : 'Your day, wrapped'
  if (mode === 'yesterday') return 'Yesterday, wrapped'
  return 'That day, wrapped'
}

function coverTeaser(facts: DayWrapFacts, mode: WrapMode, inProgress: boolean): string {
  if (facts.quality === 'tooEarly') return inProgress ? 'Just getting going.' : 'A barely-there day.'
  if (facts.isLeisureDay) return mode === 'yesterday' ? 'Yesterday was mostly off the clock.' : 'Mostly off the clock.'
  if (inProgress) return 'Here is the day so far.'
  const hours = facts.activeSeconds / 3600
  if (hours >= 8) return 'It was a long one.'
  if (hours >= 5) return 'A full one.'
  if (hours >= 2) return 'A focused few hours.'
  return 'A light one.'
}

// ─── Scenes ─────────────────────────────────────────────────────────────────────

function CoverScene({ facts, mode, inProgress, theme }: { facts: DayWrapFacts; mode: WrapMode; inProgress: boolean; theme: Theme }) {
  return (
    <Scene>
      <div style={{ marginBottom: 26 }}><Mascot expression="wave" size={92} /></div>
      <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.22em', color: theme.accent, margin: '0 0 16px', opacity: 0.9 }}>
        {facts.weekday} · {facts.dateLabel}
      </p>
      <h1 style={{ fontSize: 'clamp(40px, 6vw, 60px)', fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.03em', color: '#fff', margin: 0 }}>
        {coverTitle(mode, inProgress)}
      </h1>
      <p style={{ ...subtleLine, marginTop: 20, fontStyle: 'italic', opacity: 0.9 }}>“{coverTeaser(facts, mode, inProgress)}”</p>
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 34, letterSpacing: '0.02em' }}>tap to begin ›</p>
    </Scene>
  )
}

function HeadlineScene({ facts, lead, inProgress, theme }: { facts: DayWrapFacts; lead: string; inProgress: boolean; theme: Theme }) {
  return (
    <Scene>
      <Kicker accent={theme.accent}>{inProgress ? 'Today so far' : 'The day'}</Kicker>
      <HmCountUp
        seconds={facts.activeSeconds}
        style={{ fontSize: 'clamp(72px, 16vw, 132px)', fontWeight: 900, lineHeight: 0.95, letterSpacing: '-0.045em', color: theme.accent }}
      />
      <p style={{ ...subtleLine, marginTop: 30 }}>{lead}</p>
    </Scene>
  )
}

function ActivityRow({ rank, item, max, accent, reduced }: { rank: number; item: WrapActivity; max: number; accent: string; reduced: boolean }) {
  const [fill, setFill] = useState(reduced ? 1 : 0)
  useEffect(() => {
    if (reduced) { setFill(1); return }
    const id = setTimeout(() => setFill(1), 120 + rank * 90)
    return () => clearTimeout(id)
  }, [reduced, rank])
  const pct = Math.round((item.seconds / max) * 100)
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: accent, width: 18, textAlign: 'right', flexShrink: 0 }}>{rank}</span>
        <span style={{ fontSize: 'clamp(17px, 2.4vw, 21px)', fontWeight: 650, color: '#fff', flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.62)', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatHm(item.seconds)}</span>
      </div>
      <div style={{ marginLeft: 32, height: 5, background: 'rgba(255,255,255,0.09)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${fill * pct}%`, height: '100%', background: accent, borderRadius: 3, transition: reduced ? 'none' : 'width 1s cubic-bezier(0.16,1,0.3,1)' }} />
      </div>
    </div>
  )
}

function DidScene({ facts, insight, theme, reduced }: { facts: DayWrapFacts; insight: string | null; theme: Theme; reduced: boolean }) {
  const max = facts.workActivities[0]?.seconds ?? 1
  return (
    <Scene>
      <Kicker accent={theme.accent}>What you did</Kicker>
      <div style={{ width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {facts.workActivities.map((item, i) => (
          <ActivityRow key={item.name} rank={i + 1} item={item} max={max} accent={theme.accent} reduced={reduced} />
        ))}
      </div>
      {insight && <p style={{ ...subtleLine, fontSize: 'clamp(16px,2.4vw,21px)', marginTop: 30 }}>{insight}</p>}
    </Scene>
  )
}

function RibbonScene({ facts, story, theme, reduced }: { facts: DayWrapFacts; story: string | null; theme: Theme; reduced: boolean }) {
  const total = facts.ribbon.reduce((s, seg) => s + seg.seconds, 0) || 1
  const [grown, setGrown] = useState(reduced)
  useEffect(() => {
    if (reduced) { setGrown(true); return }
    const id = setTimeout(() => setGrown(true), 140)
    return () => clearTimeout(id)
  }, [reduced])
  return (
    <Scene>
      <Kicker accent={theme.accent}>The shape of your day</Kicker>
      <div style={{ width: '100%', maxWidth: 560 }}>
        <div style={{ display: 'flex', width: '100%', height: 60, borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,0.06)' }}>
          {facts.ribbon.map((seg, i) => (
            <div key={`${seg.name}-${i}`} title={`${seg.name} · ${formatHm(seg.seconds)}`}
              style={{
                flexGrow: grown ? seg.seconds / total : 0, flexBasis: 0, minWidth: grown ? 4 : 0,
                background: categoryColor(seg.category, seg.kind), opacity: 0.92,
                borderRight: i < facts.ribbon.length - 1 ? '1px solid rgba(0,0,0,0.28)' : 'none',
                transition: reduced ? 'none' : `flex-grow 0.9s ${i * 0.05}s cubic-bezier(0.16,1,0.3,1)`,
              }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 9, fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>
          <span>{facts.ribbonStartClock ?? ''}</span>
          <span>{facts.ribbonEndClock ?? ''}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px 18px', marginTop: 22 }}>
          {dedupeLegend(facts.ribbon).slice(0, 4).map((seg) => (
            <span key={seg.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'rgba(255,255,255,0.72)' }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: categoryColor(seg.category, seg.kind) }} />
              {seg.name}
            </span>
          ))}
        </div>
      </div>
      {story && <p style={{ ...subtleLine, marginTop: 28 }}>{story}</p>}
    </Scene>
  )
}

function dedupeLegend(ribbon: RibbonSegment[]): RibbonSegment[] {
  const byName = new Map<string, RibbonSegment>()
  for (const seg of ribbon) {
    const existing = byName.get(seg.name)
    if (existing) existing.seconds += seg.seconds
    else byName.set(seg.name, { ...seg })
  }
  return [...byName.values()].sort((a, b) => b.seconds - a.seconds)
}

function StandoutScene({ facts, theme }: { facts: DayWrapFacts; theme: Theme }) {
  const s = facts.standout!
  return (
    <Scene>
      <Kicker accent={theme.accent}>A standout</Kicker>
      <HmCountUp
        seconds={s.seconds}
        style={{ fontSize: 'clamp(64px, 13vw, 112px)', fontWeight: 900, lineHeight: 0.95, letterSpacing: '-0.04em', color: theme.accent }}
      />
      <p style={{ ...subtleLine, marginTop: 26 }}>
        your longest unbroken stretch, on {lower(s.name)}, {s.startClock} to {s.endClock}
      </p>
    </Scene>
  )
}

function lower(s: string): string {
  return /^[A-Z]{2,}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1)
}

function dayShareModel(facts: DayWrapFacts, mode: WrapMode): ShareCardModel {
  const rows = facts.isLeisureDay
    ? facts.topLeisure.slice(0, 3).map((name) => ({ name, value: '' }))
    : facts.workActivities.slice(0, 3).map((a) => ({ name: a.name, value: formatHm(a.seconds) }))
  return {
    eyebrow: `${facts.weekday.slice(0, 3)} ${facts.dateLabel}`,
    headline: formatHm(facts.activeSeconds),
    caption: facts.isLeisureDay ? 'mostly off the clock' : 'tracked across the day',
    rows,
    statLabel: facts.standout ? 'Longest stretch' : undefined,
    statValue: facts.standout ? formatHm(facts.standout.seconds) : undefined,
    footer: mode === 'yesterday' ? 'yesterday, wrapped by Daylens' : 'wrapped by Daylens',
  }
}

function FinaleScene({
  facts, mode, theme, onClose, onOpenReport, onRestart, bridge,
}: {
  facts: DayWrapFacts; mode: WrapMode; theme: Theme
  onClose: () => void; onOpenReport: () => void; onRestart: () => void; bridge: string | null
}) {
  const [saved, setSaved] = useState(false)
  const top3 = facts.isLeisureDay
    ? facts.topLeisure.slice(0, 3).map((name) => ({ name, sub: 'leisure' }))
    : facts.workActivities.slice(0, 3).map((a) => ({ name: a.name, sub: formatHm(a.seconds) }))

  return (
    <Scene>
      <div style={cardSurface}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
          <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.18em', color: theme.accent }}>DAYLENS</span>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.55)' }}>{facts.weekday.slice(0, 3)} {facts.dateLabel}</span>
        </div>
        <div style={{ fontSize: 56, fontWeight: 900, letterSpacing: '-0.045em', color: '#fff', lineHeight: 1 }}>{formatHm(facts.activeSeconds)}</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', marginTop: 4, marginBottom: 20 }}>{facts.isLeisureDay ? 'mostly off the clock' : 'tracked across the day'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {top3.map((row, i) => (
            <div key={row.name} style={{ display: 'flex', alignItems: 'baseline', gap: 11 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: theme.accent, width: 14, flexShrink: 0 }}>{i + 1}</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
              <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap' }}>{row.sub}</span>
            </div>
          ))}
        </div>
        {facts.standout && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.12)', fontSize: 14, color: 'rgba(255,255,255,0.72)' }}>
            Longest stretch: <span style={{ color: '#fff', fontWeight: 700 }}>{formatHm(facts.standout.seconds)}</span>
          </div>
        )}
      </div>

      {bridge && <p style={{ ...subtleLine, fontSize: 'clamp(15px,2.2vw,19px)', marginTop: 22 }}>{bridge}</p>}

      <div style={finaleActions}>
        <button onClick={(e) => { e.stopPropagation(); void saveShareCard(dayShareModel(facts, mode), `daylens-${facts.date}.png`).then(setSaved) }} style={primaryButton(theme.accent)}>
          {saved ? 'Saved ✓' : 'Save image'}
        </button>
        <button onClick={(e) => { e.stopPropagation(); onOpenReport() }} style={ghostButton}>{mode === 'yesterday' ? 'Continue your day' : 'Open timeline'}</button>
        <button onClick={(e) => { e.stopPropagation(); onRestart() }} style={ghostButton} aria-label="Replay">↺</button>
        <button onClick={(e) => { e.stopPropagation(); onClose() }} style={ghostButton}>Done</button>
      </div>
    </Scene>
  )
}

export const cardSurface: CSSProperties = {
  width: 'min(420px, 82vw)', borderRadius: 22, padding: '30px 30px 26px',
  background: 'linear-gradient(165deg, rgba(255,255,255,0.09), rgba(255,255,255,0.03))',
  border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 30px 70px rgba(0,0,0,0.5)',
  textAlign: 'left', pointerEvents: 'none',
}
export const finaleActions: CSSProperties = { display: 'flex', gap: 12, marginTop: 28, pointerEvents: 'all', flexWrap: 'wrap', justifyContent: 'center' }

// ─── Main component ─────────────────────────────────────────────────────────────

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
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const facts = useMemo(() => buildDayWrapFacts(data), [data])
  const mode = useMemo(() => resolveMode(data.date), [data.date])
  const inProgress = mode === 'today' && new Date().getHours() < 18

  const [provider, setProvider] = useState<WrapProviderState | null>(null)
  const [narrative, setNarrative] = useState<AIWrappedNarrative | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setNarrative(null)
    void (async () => {
      const state = await ipc.ai.getWrapProviderState().catch(() => ({ connected: false, provider: null } as WrapProviderState))
      if (cancelled) return
      setProvider(state)
      if (!state.connected) { setLoaded(true); return }
      const day = await ipc.ai.getWrappedNarrative(data.date).catch(() => null)
      if (cancelled) return
      setNarrative(day ?? null)
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [data.date])

  const scenes: BuiltScene[] = useMemo(() => {
    if (!loaded || !provider) return [{ theme: THEME.rest, render: () => <MessageScene kicker="Wrapped" title="Writing your wrap…" theme={THEME.rest} /> }]
    if (!provider.connected) return [{
      theme: THEME.rest,
      render: () => (
        <MessageScene kicker="Wrapped" title="No provider connected, so there's no wrap." theme={THEME.rest}
          body="Connect one in Settings and your day gets written up.">
          <div style={{ display: 'flex', gap: 12, marginTop: 38, pointerEvents: 'all' }}>
            <button onClick={(e) => { e.stopPropagation(); if (onOpenSettings) onOpenSettings(); else onClose() }} style={primaryButton(THEME.rest.accent)}>Open Settings →</button>
            <button onClick={(e) => { e.stopPropagation(); onClose() }} style={ghostButton}>Dismiss</button>
          </div>
        </MessageScene>
      ),
    }]
    if (facts.quality === 'empty' || facts.activeSeconds <= 0 || !narrative) return [{
      theme: THEME.rest,
      render: () => (
        <MessageScene kicker="Wrapped" title="A quiet one." body="Not much tracked yet. Come back once the day has more in it." theme={THEME.rest}>
          <div style={{ display: 'flex', gap: 12, marginTop: 38, pointerEvents: 'all' }}>
            <button onClick={(e) => { e.stopPropagation(); onClose() }} style={ghostButton}>Done</button>
          </div>
        </MessageScene>
      ),
    }]

    const out: BuiltScene[] = []
    out.push({ theme: THEME.cover, render: () => <CoverScene facts={facts} mode={mode} inProgress={inProgress} theme={THEME.cover} /> })
    out.push({ theme: THEME.headline, render: () => <HeadlineScene facts={facts} lead={narrative.lead} inProgress={inProgress} theme={THEME.headline} /> })
    if (!facts.isLeisureDay) {
      if (facts.workActivities.length > 0 && facts.workSeconds >= 15 * 60) {
        out.push({ theme: THEME.did, render: () => <DidScene facts={facts} insight={narrative.slides.topApp} theme={THEME.did} reduced={reduced} /> })
      }
      if (facts.ribbon.length >= 2) {
        out.push({ theme: THEME.shape, render: () => <RibbonScene facts={facts} story={narrative.slides.scale} theme={THEME.shape} reduced={reduced} /> })
      }
      if (facts.standout) {
        out.push({ theme: THEME.standout, render: () => <StandoutScene facts={facts} theme={THEME.standout} /> })
      }
    }
    // No open-thread / carryover slide, and no "pick it up" bridge (locked
    // decision): Daylens never predicts tomorrow. The finale closes the day.
    out.push({ theme: THEME.finale, render: (onRestart) => <FinaleScene facts={facts} mode={mode} theme={THEME.finale} onClose={onClose} onOpenReport={onOpenReport} onRestart={onRestart} bridge={null} /> })
    return out
  }, [loaded, provider, facts, narrative, mode, inProgress, reduced, onClose, onOpenReport, onOpenSettings])

  return <WrapStory scenes={scenes} onClose={onClose} />
}
