import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { AIWrappedNarrative, DayTimelinePayload, WrapProviderState } from '@shared/types'
import { ipc } from '../lib/ipc'
import { todayString, shiftDateString } from '../lib/format'
import Mascot from './Mascot'
import WrapStory from './wrap/WrapStory'
import {
  BuiltScene, HmCountUp, Kicker, MessageScene, Scene, Theme,
  formatHm, ghostButton, layoutVariant, pickPalette, primaryButton,
  saveShareCard, shareGradient, subtleLine, type ShareCardModel, type WrapPalette,
} from './wrap/wrapKit'
import {
  buildDayWrapFacts, type AppSiteSlice, type DayStorySegment, type DayWrapFacts, type WrapActivity,
} from '../lib/dayWrapScenes'

// ─── Daily Wrapped (DEV-114) ───────────────────────────────────────────────────
// Spotify Wrapped, for one day, on the shared <WrapStory> engine. The arc:
// hook → a short "recap being cooked" build beat → the headline → what you did →
// the day as a story (morning / midday / evening) → where the time went →
// the wildcard → the shareable finale.
//
// Every number comes from ONE deterministic facts object (`buildDayWrapFacts`),
// the same object the main process narrates from, so no card can disagree. The
// AI writes prose on top; it never invents a number. Palette, layout, and which
// hook leads vary by a per-day seed, so the same kind of day never looks the same
// twice. With no provider connected we show one Settings message and nothing else.

type WrapMode = 'today' | 'yesterday' | 'past'

const WORK_THRESHOLD_SECONDS = 2 * 60 * 60

function resolveMode(date: string): WrapMode {
  const today = todayString()
  if (date === today) return 'today'
  if (date === shiftDateString(today, -1)) return 'yesterday'
  return 'past'
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

// The under-threshold line for the live day, voiced loosely (the real voice
// comes from Settings; this is the honest deterministic floor). Names the real
// number, never dares the user.
function underThresholdLine(workSeconds: number): string {
  const m = Math.max(1, Math.round(workSeconds / 60))
  const t = workSeconds >= 60 * 60 ? formatHm(workSeconds) : `${m} minutes`
  return `${t} of work so far. Give the day a little more and come back.`
}

// ─── Scenes ─────────────────────────────────────────────────────────────────────

function CoverScene({ facts, mode, inProgress, theme }: { facts: DayWrapFacts; mode: WrapMode; inProgress: boolean; theme: Theme }) {
  const align = layoutVariant(facts.seed) === 1 ? 'flex-start' : 'center'
  return (
    <Scene>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: align, textAlign: align === 'center' ? 'center' : 'left', width: '100%' }}>
        <div style={{ marginBottom: 26 }}><Mascot expression="wave" size={92} /></div>
        <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.22em', color: theme.accent, margin: '0 0 16px', opacity: 0.9 }}>
          {facts.weekday} · {facts.dateLabel}
        </p>
        <h1 style={{ fontSize: 'clamp(40px, 6vw, 60px)', fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.03em', color: '#fff', margin: 0 }}>
          {mode === 'yesterday' ? 'Yesterday, wrapped' : inProgress ? 'Today so far' : 'Your day, wrapped'}
        </h1>
        <p style={{ ...subtleLine, marginTop: 20, fontStyle: 'italic', opacity: 0.9 }}>“{coverTeaser(facts, mode, inProgress)}”</p>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 34, letterSpacing: '0.02em' }}>tap to begin ›</p>
      </div>
    </Scene>
  )
}

// The "recap being cooked" beat, reusing the onboarding build motion: mock day
// rows drop in and stack, then we move on. Calm and instant under reduced motion.
function BuildBeatScene({ facts, theme, reduced }: { facts: DayWrapFacts; theme: Theme; reduced: boolean }) {
  const rows = facts.workActivities.slice(0, 3).map((a) => a.name)
  while (rows.length < 3) rows.push('')
  const [stacked, setStacked] = useState(reduced)
  useEffect(() => {
    if (reduced) { setStacked(true); return }
    const id = setTimeout(() => setStacked(true), 80)
    return () => clearTimeout(id)
  }, [reduced])
  return (
    <Scene>
      <Kicker accent={theme.accent}>Looking at your day</Kicker>
      <div style={{ width: 'min(420px, 78vw)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((label, i) => (
          <div key={i}
            style={{
              height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', paddingLeft: 16,
              background: i === 0 ? `linear-gradient(135deg, ${theme.accent}44, ${theme.accent}22)` : 'rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.92)', fontSize: 14, fontWeight: 650,
              opacity: stacked ? 1 : 0,
              transform: stacked ? 'translateY(0)' : 'translateY(-28px)',
              transition: reduced ? 'none' : `opacity 420ms ${i * 110}ms cubic-bezier(0.2,1.1,0.3,1), transform 420ms ${i * 110}ms cubic-bezier(0.2,1.1,0.3,1)`,
            }}>
            {label}
          </div>
        ))}
      </div>
      <p style={{ ...subtleLine, marginTop: 26 }}>A few things stood out.</p>
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

function DidScene({ facts, theme, reduced }: { facts: DayWrapFacts; theme: Theme; reduced: boolean }) {
  const max = facts.workActivities[0]?.seconds ?? 1
  return (
    <Scene>
      <Kicker accent={theme.accent}>What you did</Kicker>
      <div style={{ width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {facts.workActivities.map((item, i) => (
          <ActivityRow key={item.name} rank={i + 1} item={item} max={max} accent={theme.accent} reduced={reduced} />
        ))}
      </div>
    </Scene>
  )
}

const PART_LABEL: Record<DayStorySegment['part'], string> = { morning: 'Morning', midday: 'Midday', evening: 'Evening' }

function StoryScene({ seg, line, theme }: { seg: DayStorySegment; line: string | null; theme: Theme }) {
  const fallback = seg.items.length > 0
    ? `${PART_LABEL[seg.part]} went to ${seg.items.slice(0, 2).map(lower).join(' and ')}.`
    : `${PART_LABEL[seg.part]} was a quieter stretch.`
  return (
    <Scene>
      <Kicker accent={theme.accent}>{PART_LABEL[seg.part]} · {seg.clockStart} to {seg.clockEnd}</Kicker>
      <h1 style={{ fontSize: 'clamp(26px, 4.2vw, 44px)', fontWeight: 750, lineHeight: 1.18, letterSpacing: '-0.02em', color: '#fff', margin: 0, maxWidth: '24ch' }}>
        {line ?? fallback}
      </h1>
    </Scene>
  )
}

function WhereScene({ facts, line, theme, reduced }: { facts: DayWrapFacts; line: string | null; theme: Theme; reduced: boolean }) {
  const max = facts.appSites[0]?.seconds ?? 1
  return (
    <Scene>
      <Kicker accent={theme.accent}>Where the time went</Kicker>
      <div style={{ width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {facts.appSites.map((slice, i) => (
          <DistRow key={`${slice.name}-${i}`} slice={slice} max={max} accent={slice.kind === 'other' ? 'rgba(255,255,255,0.34)' : theme.accent} reduced={reduced} rank={i} />
        ))}
      </div>
      {line && <p style={{ ...subtleLine, fontSize: 'clamp(16px,2.4vw,21px)', marginTop: 26 }}>{line}</p>}
    </Scene>
  )
}

function DistRow({ slice, max, accent, reduced, rank }: { slice: AppSiteSlice; max: number; accent: string; reduced: boolean; rank: number }) {
  const [fill, setFill] = useState(reduced ? 1 : 0)
  useEffect(() => {
    if (reduced) { setFill(1); return }
    const id = setTimeout(() => setFill(1), 120 + rank * 80)
    return () => clearTimeout(id)
  }, [reduced, rank])
  const pct = Math.round((slice.seconds / max) * 100)
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 'clamp(15px, 2.2vw, 19px)', fontWeight: 650, color: slice.kind === 'other' ? 'rgba(255,255,255,0.6)' : '#fff', flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slice.name}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap' }}>{formatHm(slice.seconds)}</span>
      </div>
      <div style={{ height: 5, background: 'rgba(255,255,255,0.09)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${fill * pct}%`, height: '100%', background: accent, borderRadius: 3, transition: reduced ? 'none' : 'width 0.9s cubic-bezier(0.16,1,0.3,1)' }} />
      </div>
    </div>
  )
}

function WildcardScene({ facts, line, theme }: { facts: DayWrapFacts; line: string | null; theme: Theme }) {
  const hook = facts.wildcardHook!
  return (
    <Scene>
      <Kicker accent={theme.accent}>And one more thing</Kicker>
      {hook.seconds != null ? (
        <HmCountUp seconds={hook.seconds} style={{ fontSize: 'clamp(60px, 13vw, 110px)', fontWeight: 900, lineHeight: 0.95, letterSpacing: '-0.04em', color: theme.accent }} />
      ) : (
        <span style={{ fontSize: 'clamp(64px, 14vw, 120px)', fontWeight: 900, lineHeight: 0.95, letterSpacing: '-0.04em', color: theme.accent }}>{hook.value}</span>
      )}
      <p style={{ ...subtleLine, marginTop: 26 }}>{line ?? `${hook.caption}.`}</p>
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
    ...shareGradient(facts.seed),
  }
}

function FinaleScene({
  facts, mode, theme, onClose, onOpenReport, onRestart, onRegenerate, generatedLabel,
}: {
  facts: DayWrapFacts; mode: WrapMode; theme: Theme
  onClose: () => void; onOpenReport: () => void; onRestart: () => void
  onRegenerate: () => void; generatedLabel: string | null
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

      {generatedLabel && (
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginTop: 16, pointerEvents: 'all' }}>
          generated {generatedLabel} · <button onClick={(e) => { e.stopPropagation(); onRegenerate() }} style={linkButton}>Regenerate</button>
        </p>
      )}

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
const linkButton: CSSProperties = { background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12, padding: 0 }

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
  const palette = useMemo<WrapPalette>(() => pickPalette(facts.seed), [facts.seed])

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
      const day = await ipc.ai.getWrappedNarrative(data.date, reloadKey > 0).catch(() => null)
      if (cancelled) return
      setNarrative(day ?? null)
      setGeneratedAt(Date.now())
      setLoaded(true)
    })()
    return () => { cancelled = true }
  }, [data.date, gated, reloadKey])

  const generatedLabel = generatedAt ? relativeTime(generatedAt) : null

  const scenes: BuiltScene[] = useMemo(() => {
    // Under the live-day threshold: the light line + a quiet "Generate anyway".
    if (gated) return [{
      theme: palette.rest,
      render: () => (
        <MessageScene kicker="Today so far" title={underThresholdLine(facts.workSeconds)} theme={palette.rest}>
          <div style={{ display: 'flex', gap: 12, marginTop: 38, pointerEvents: 'all' }}>
            <button onClick={(e) => { e.stopPropagation(); setForced(true) }} style={ghostButton}>Generate anyway</button>
            <button onClick={(e) => { e.stopPropagation(); onClose() }} style={ghostButton}>Not yet</button>
          </div>
        </MessageScene>
      ),
    }]
    if (!loaded || !provider) return [{ theme: palette.rest, render: () => <MessageScene kicker="Wrapped" title="Writing your wrap…" theme={palette.rest} /> }]
    if (!provider.connected) return [{
      theme: palette.rest,
      render: () => (
        <MessageScene kicker="Wrapped" title="No provider connected, so there's no wrap." theme={palette.rest}
          body="Connect one in Settings and your day gets written up.">
          <div style={{ display: 'flex', gap: 12, marginTop: 38, pointerEvents: 'all' }}>
            <button onClick={(e) => { e.stopPropagation(); if (onOpenSettings) onOpenSettings(); else onClose() }} style={primaryButton(palette.rest.accent)}>Open Settings →</button>
            <button onClick={(e) => { e.stopPropagation(); onClose() }} style={ghostButton}>Dismiss</button>
          </div>
        </MessageScene>
      ),
    }]
    if (facts.quality === 'empty' || facts.activeSeconds <= 0 || !narrative) return [{
      theme: palette.rest,
      render: () => (
        <MessageScene kicker="Wrapped" title="A quiet one." body="Not much tracked yet. Come back once the day has more in it." theme={palette.rest}>
          <div style={{ display: 'flex', gap: 12, marginTop: 38, pointerEvents: 'all' }}>
            <button onClick={(e) => { e.stopPropagation(); onClose() }} style={ghostButton}>Done</button>
          </div>
        </MessageScene>
      ),
    }]

    const out: BuiltScene[] = []
    const stem = `daylens-${facts.date}`
    out.push({ theme: palette.cover, render: () => <CoverScene facts={facts} mode={mode} inProgress={inProgress} theme={palette.cover} /> })

    if (!facts.isLeisureDay && facts.workActivities.length > 0) {
      out.push({ theme: palette.did, render: () => <BuildBeatScene facts={facts} theme={palette.did} reduced={reduced} /> })
    }

    out.push({
      theme: palette.headline,
      render: () => <HeadlineScene facts={facts} lead={narrative.lead} inProgress={inProgress} theme={palette.headline} />,
      share: dayShareModel(facts, mode), shareName: `${stem}-headline`,
    })

    if (!facts.isLeisureDay) {
      if (facts.workActivities.length > 0 && facts.workSeconds >= 15 * 60) {
        out.push({
          theme: palette.did, render: () => <DidScene facts={facts} theme={palette.did} reduced={reduced} />,
          share: dayShareModel(facts, mode), shareName: `${stem}-did`,
        })
      }

      // The day as a story: lead with morning, then the busier of midday/evening.
      const beats: Array<{ seg: DayStorySegment; line: string | null }> = []
      if (facts.dayStory.morning) beats.push({ seg: facts.dayStory.morning, line: narrative.story.morning })
      const mid = facts.dayStory.midday
      const eve = facts.dayStory.evening
      const later = mid && eve ? (eve.seconds > mid.seconds ? eve : mid) : (mid ?? eve)
      const laterLine = later === eve ? narrative.story.evening : narrative.story.midday
      if (later) beats.push({ seg: later, line: laterLine })
      for (const beat of beats.slice(0, 2)) {
        out.push({ theme: palette.shape, render: () => <StoryScene seg={beat.seg} line={beat.line} theme={palette.shape} /> })
      }

      if (facts.appSites.length >= 2) {
        out.push({
          theme: palette.thread, render: () => <WhereScene facts={facts} line={narrative.whereLine} theme={palette.thread} reduced={reduced} />,
          share: dayShareModel(facts, mode), shareName: `${stem}-where`,
        })
      }

      if (facts.wildcardHook) {
        out.push({ theme: palette.standout, render: () => <WildcardScene facts={facts} line={narrative.wildcard} theme={palette.standout} /> })
      }
    }

    out.push({
      theme: palette.finale,
      render: (onRestart) => (
        <FinaleScene
          facts={facts} mode={mode} theme={palette.finale} onClose={onClose} onOpenReport={onOpenReport}
          onRestart={onRestart} onRegenerate={() => setReloadKey((k) => k + 1)} generatedLabel={generatedLabel}
        />
      ),
      share: dayShareModel(facts, mode), shareName: `${stem}-finale`,
    })
    return out
  }, [gated, loaded, provider, facts, narrative, mode, inProgress, reduced, palette, generatedLabel, onClose, onOpenReport, onOpenSettings])

  return <WrapStory scenes={scenes} onClose={onClose} />
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
