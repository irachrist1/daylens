import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AIWrappedNarrative,
  AppCategory,
  DayTimelinePayload,
  WrappedPeriod,
  WrappedPeriodFacts,
  WrappedPeriodNarrative,
  WrapProviderState,
} from '@shared/types'
import { blockActiveSeconds } from '@shared/blockDuration'
import { effectiveBlockKind } from '@shared/workKind'
import { ipc } from '../lib/ipc'

// ─── Briefs & Wraps (DEV-103) ──────────────────────────────────────────────────
// Spotify-Wrapped, done right. Every word here comes from a real AI call (the
// `narrative` fetched per date / period). No grades, no focus scores, no "% of a
// 16-hour day" — the deleted slides were exactly what briefs-wraps.md §2 calls
// out. With no provider connected we show one message and nothing else (§7).
//
// The evening wrap is at most 5 cards on a working day (Shape · Worked on · Where
// the time went · Open thread · Close) and collapses to 2 on a leisure day. The
// weekly / monthly / annual wraps read from frozen daily snapshots, so the hero
// number and the narrative always agree.

// ─── Visual language — bold, full-bleed, Wrapped-style ─────────────────────────

interface SlideTheme { bg: string; accent: string; glow: string }

const WRAP_THEMES: SlideTheme[] = [
  { bg: 'linear-gradient(155deg,#0b1020 0%,#15235e 52%,#2747b8 100%)', accent: '#b9ccff', glow: 'rgba(77,120,255,0.45)' },
  { bg: 'linear-gradient(155deg,#0a1a16 0%,#0f4338 52%,#16846a 100%)', accent: '#74f0cf', glow: 'rgba(40,210,160,0.42)' },
  { bg: 'linear-gradient(155deg,#1c0a22 0%,#48104f 52%,#8a1f86 100%)', accent: '#f0a6f5', glow: 'rgba(220,80,230,0.42)' },
  { bg: 'linear-gradient(155deg,#1d1407 0%,#5a3208 52%,#c87914 100%)', accent: '#ffd79a', glow: 'rgba(255,170,70,0.42)' },
  { bg: 'linear-gradient(155deg,#170a0a 0%,#4a1414 52%,#8a2626 100%)', accent: '#ffb0b0', glow: 'rgba(230,90,90,0.42)' },
  { bg: 'linear-gradient(155deg,#0a121f 0%,#123a52 52%,#1a6a86 100%)', accent: '#8fe0f5', glow: 'rgba(60,180,220,0.42)' },
]

const REST_THEME: SlideTheme = { bg: 'linear-gradient(155deg,#10131c 0%,#23304a 55%,#3a4f74 100%)', accent: '#cdd9f0', glow: 'rgba(160,185,230,0.36)' }
const CLOSE_THEME: SlideTheme = { bg: 'linear-gradient(155deg,#0a0d14 0%,#161d2c 55%,#27324a 100%)', accent: '#cfe0ff', glow: 'rgba(150,180,230,0.3)' }

const CAT_ACCENT: Partial<Record<AppCategory, string>> = {
  development: '#7eb2ff', design: '#f472b6', communication: '#34d9c4', research: '#b87aff',
  writing: '#7eb8ff', aiTools: '#e040fb', productivity: '#4ade80', meetings: '#f59e0b',
  email: '#22d3ee', browsing: '#fb923c', social: '#a78bfa', entertainment: '#ff6b6b',
}

const CAT_LABEL: Partial<Record<AppCategory, string>> = {
  development: 'Development', design: 'Design', communication: 'Communication', research: 'Research',
  writing: 'Writing', aiTools: 'AI tools', productivity: 'Productivity', meetings: 'Meetings',
  email: 'Email', browsing: 'Browsing', social: 'Social', entertainment: 'Entertainment',
}

// ─── Count-up (shared rAF clock) ────────────────────────────────────────────────

interface CountUpAnim { start: number; duration: number; target: number; set: (v: number) => void }
const activeCountUps = new Set<CountUpAnim>()
let countUpRaf: number | null = null

function pumpCountUps(now: number): void {
  for (const anim of activeCountUps) {
    const t = Math.min((now - anim.start) / anim.duration, 1)
    anim.set(Math.round((1 - Math.pow(1 - t, 3)) * anim.target))
    if (t >= 1) activeCountUps.delete(anim)
  }
  countUpRaf = activeCountUps.size > 0 ? requestAnimationFrame(pumpCountUps) : null
}

function useCountUp(target: number, duration = 900): number {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (target === 0) { setVal(0); return }
    const anim: CountUpAnim = { start: performance.now(), duration, target, set: setVal }
    activeCountUps.add(anim)
    if (countUpRaf == null) countUpRaf = requestAnimationFrame(pumpCountUps)
    return () => { activeCountUps.delete(anim) }
  }, [target, duration])
  return val
}

function useAnimatedFill(target: number, delayMs = 120): number {
  const [fill, setFill] = useState(0)
  useEffect(() => {
    const id = setTimeout(() => setFill(target), delayMs)
    return () => clearTimeout(id)
  }, [target, delayMs])
  return fill
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function formatHm(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${Math.max(0, m)}m`
}

interface KindTotals { work: number; leisure: number; personal: number; idle: number }

function kindTotals(data: DayTimelinePayload): KindTotals {
  const totals: KindTotals = { work: 0, leisure: 0, personal: 0, idle: 0 }
  for (const block of data.blocks) {
    totals[effectiveBlockKind(block)] += blockActiveSeconds(block)
  }
  return totals
}

function isLeisureDay(totals: KindTotals): boolean {
  const tracked = totals.work + totals.leisure + totals.personal
  return tracked > 0 && totals.leisure >= totals.work && totals.leisure / tracked >= 0.5
}

/** Work-category breakdown for the "where the time went" legend. Totals come
 *  from the same trusted blocks the Timeline reads — never an independent sum. */
function workCategoryBreakdown(data: DayTimelinePayload): Array<{ category: AppCategory; seconds: number }> {
  const map = new Map<AppCategory, number>()
  for (const block of data.blocks) {
    const cat = block.dominantCategory
    if (cat === 'system' || cat === 'uncategorized' || cat === 'entertainment' || cat === 'social') continue
    if (effectiveBlockKind(block) !== 'work') continue
    map.set(cat, (map.get(cat) ?? 0) + blockActiveSeconds(block))
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([category, seconds]) => ({ category, seconds }))
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function SlideBody({ children }: { children: ReactNode }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      alignItems: 'flex-start', padding: '92px 64px 72px',
      pointerEvents: 'none',
    }}>
      {children}
    </div>
  )
}

function Kicker({ children, accent }: { children: ReactNode; accent: string }) {
  return (
    <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: accent, margin: '0 0 22px', opacity: 0.9 }}>
      {children}
    </p>
  )
}

function Headline({ children, size = 56 }: { children: ReactNode; size?: number }) {
  return (
    <h1 style={{ fontSize: size, fontWeight: 800, lineHeight: 1.08, letterSpacing: '-0.025em', color: '#fff', margin: 0, maxWidth: '20ch' }}>
      {children}
    </h1>
  )
}

// ─── Category legend (where the time went) ─────────────────────────────────────

function LegendRow({ item, total, maxSec }: { item: { category: AppCategory; seconds: number }; total: number; maxSec: number }) {
  const accent = CAT_ACCENT[item.category] ?? '#9bb0d6'
  const pct = total > 0 ? Math.round((item.seconds / total) * 100) : 0
  const barFill = useAnimatedFill(Math.round((item.seconds / maxSec) * 100))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
        <span style={{ color: 'rgba(255,255,255,0.82)', fontWeight: 600 }}>{CAT_LABEL[item.category] ?? item.category}</span>
        <span style={{ color: 'rgba(255,255,255,0.5)' }}>{formatHm(item.seconds)}<span style={{ color: 'rgba(255,255,255,0.3)', marginLeft: 8 }}>{pct}%</span></span>
      </div>
      <div style={{ width: '100%', height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${barFill}%`, height: '100%', background: accent, borderRadius: 3, transition: 'width 1.1s cubic-bezier(0.16,1,0.3,1)' }} />
      </div>
    </div>
  )
}

function CategoryLegend({ items, total }: { items: Array<{ category: AppCategory; seconds: number }>; total: number }) {
  const top = items.slice(0, 5)
  const maxSec = top[0]?.seconds ?? 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 11, width: '100%', maxWidth: 460, marginTop: 30 }}>
      {top.map((item) => <LegendRow key={item.category} item={item} total={total} maxSec={maxSec} />)}
    </div>
  )
}

// ─── Shape bar (the month/year shape) ──────────────────────────────────────────

function ShapeBars({ buckets, accent, glow }: { buckets: WrappedPeriodFacts['buckets']; accent: string; glow: string }) {
  const max = Math.max(...buckets.map((b) => b.totalSeconds), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: buckets.length > 8 ? 6 : 10, marginTop: 34, height: 120, width: '100%', maxWidth: 520 }}>
      {buckets.map((b, i) => {
        const rel = b.totalSeconds / max
        const h = Math.max(4, Math.round(rel * 104))
        const isPeak = b.totalSeconds === max && max > 1
        return (
          <div key={`${b.label}-${i}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1 }}>
            <div style={{ width: '100%', height: h, borderRadius: 4, background: accent, opacity: isPeak ? 1 : 0.4, boxShadow: isPeak ? `0 0 14px ${glow}` : 'none', transition: `height 0.9s ${i * 0.05}s cubic-bezier(0.16,1,0.3,1)` }} />
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: isPeak ? 700 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
              {buckets.length > 8 ? b.label.slice(0, 1) : b.label.replace('Week of ', '')}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Day cards ──────────────────────────────────────────────────────────────────

function ShapeCard({ line, totals, theme }: { line: string; totals: KindTotals; theme: SlideTheme }) {
  const trackedH = useCountUp(Math.floor((totals.work + totals.leisure + totals.personal) / 3600))
  const trackedM = useCountUp(Math.floor(((totals.work + totals.leisure + totals.personal) % 3600) / 60))
  return (
    <SlideBody>
      <Kicker accent={theme.accent}>The day</Kicker>
      <h1 style={{ fontSize: 100, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.035em', margin: 0, color: theme.accent }}>
        {trackedH}h {trackedM}m
      </h1>
      <p style={{ fontSize: 24, fontWeight: 400, lineHeight: 1.45, color: 'rgba(255,255,255,0.78)', margin: '22px 0 0', maxWidth: '30ch' }}>
        {line}
      </p>
    </SlideBody>
  )
}

function TextCard({ kicker, line, theme, size = 52 }: { kicker: string; line: string; theme: SlideTheme; size?: number }) {
  return (
    <SlideBody>
      <Kicker accent={theme.accent}>{kicker}</Kicker>
      <Headline size={size}>{line}</Headline>
    </SlideBody>
  )
}

function WhereCard({ line, breakdown, total, theme }: { line: string; breakdown: Array<{ category: AppCategory; seconds: number }>; total: number; theme: SlideTheme }) {
  return (
    <SlideBody>
      <Kicker accent={theme.accent}>Where the time went</Kicker>
      <h1 style={{ fontSize: 40, fontWeight: 750, lineHeight: 1.18, letterSpacing: '-0.02em', color: '#fff', margin: 0, maxWidth: '26ch' }}>
        {line}
      </h1>
      {breakdown.length > 0 && <CategoryLegend items={breakdown} total={total} />}
    </SlideBody>
  )
}

function CloseCard({ line, theme, onClose, onOpenReport, hasReport }: { line: string; theme: SlideTheme; onClose: () => void; onOpenReport: () => void; hasReport: boolean }) {
  return (
    <SlideBody>
      <Kicker accent={theme.accent}>That's the day</Kicker>
      <Headline size={56}>{line}</Headline>
      <div style={{ display: 'flex', gap: 12, marginTop: 44, pointerEvents: 'all' }}>
        {hasReport && (
          <button onClick={(e) => { e.stopPropagation(); onOpenReport() }} style={primaryButton(theme.accent)}>Open full recap →</button>
        )}
        <button onClick={(e) => { e.stopPropagation(); onClose() }} style={ghostButton}>Done</button>
      </div>
    </SlideBody>
  )
}

// ─── Period (week / month / year) cards ─────────────────────────────────────────

function PeriodLeadCard({ facts, line, theme }: { facts: WrappedPeriodFacts; line: string; theme: SlideTheme }) {
  const h = useCountUp(Math.floor(facts.totalSeconds / 3600))
  const m = useCountUp(Math.floor((facts.totalSeconds % 3600) / 60))
  const periodWord = facts.period === 'week' ? 'This week' : facts.period === 'month' ? 'This month' : 'This year'
  return (
    <SlideBody>
      <Kicker accent={theme.accent}>{periodWord} · {facts.rangeLabel}</Kicker>
      <h1 style={{ fontSize: 96, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.035em', margin: 0, color: theme.accent }}>
        {h}h {m}m
      </h1>
      <p style={{ fontSize: 23, fontWeight: 400, lineHeight: 1.45, color: 'rgba(255,255,255,0.78)', margin: '22px 0 0', maxWidth: '32ch' }}>
        {line}
      </p>
    </SlideBody>
  )
}

function PeriodMatteredCard({ facts, line, theme }: { facts: WrappedPeriodFacts; line: string | null; theme: SlideTheme }) {
  return (
    <SlideBody>
      <Kicker accent={theme.accent}>What mattered</Kicker>
      {line && <Headline size={40}>{line}</Headline>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%', maxWidth: 520, marginTop: line ? 30 : 0 }}>
        {facts.threads.slice(0, 4).map((t, i) => (
          <div key={`${t.subject}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 10 }}>
            <span style={{ fontSize: 19, fontWeight: 600, color: '#fff', maxWidth: '20ch' }}>{t.subject}</span>
            <span style={{ fontSize: 16, color: theme.accent, fontWeight: 700, whiteSpace: 'nowrap' }}>
              {formatHm(t.seconds)}{t.daysActive > 1 ? <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}> · {t.daysActive} days</span> : null}
            </span>
          </div>
        ))}
      </div>
    </SlideBody>
  )
}

function PeriodWhereCard({ facts, line, theme }: { facts: WrappedPeriodFacts; line: string | null; theme: SlideTheme }) {
  return (
    <SlideBody>
      <Kicker accent={theme.accent}>Where the time went</Kicker>
      {line && (
        <h1 style={{ fontSize: 38, fontWeight: 750, lineHeight: 1.18, letterSpacing: '-0.02em', color: '#fff', margin: 0, maxWidth: '26ch' }}>{line}</h1>
      )}
      {facts.categories.length > 0 && <CategoryLegend items={facts.categories} total={facts.categories.reduce((s, c) => s + c.seconds, 0)} />}
    </SlideBody>
  )
}

function PeriodStandoutCard({ facts, line, theme }: { facts: WrappedPeriodFacts; line: string | null; theme: SlideTheme }) {
  return (
    <SlideBody>
      <Kicker accent={theme.accent}>A standout</Kicker>
      <Headline size={48}>{line ?? standoutFallbackText(facts)}</Headline>
      {facts.buckets.length > 1 && <ShapeBars buckets={facts.buckets} accent={theme.accent} glow={theme.glow} />}
    </SlideBody>
  )
}

function standoutFallbackText(facts: WrappedPeriodFacts): string {
  if (facts.longestStretch) return `Your longest stretch was ${formatHm(facts.longestStretch.seconds)} on ${facts.longestStretch.dayLabel}.`
  if (facts.busiestDay) return `${facts.busiestDay.dayLabel} carried the most — ${formatHm(facts.busiestDay.totalSeconds)}.`
  return 'A steady stretch, no single day pulling away.'
}

function PeriodCarryingCard({ line, theme, onClose }: { line: string; theme: SlideTheme; onClose: () => void }) {
  return (
    <SlideBody>
      <Kicker accent={theme.accent}>Carrying forward</Kicker>
      <Headline size={48}>{line}</Headline>
      <div style={{ display: 'flex', gap: 12, marginTop: 44, pointerEvents: 'all' }}>
        <button onClick={(e) => { e.stopPropagation(); onClose() }} style={ghostButton}>Done</button>
      </div>
    </SlideBody>
  )
}

// ─── Connect-provider message (the only thing shown with no credits, §7) ────────

function ConnectProviderCard({ provider, onOpenSettings, onClose }: { provider: string | null; onOpenSettings: () => void; onClose: () => void }) {
  return (
    <SlideBody>
      <Kicker accent={REST_THEME.accent}>Wrapped</Kicker>
      <Headline size={48}>Connect a provider to see your wrap.</Headline>
      <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.6)', margin: '20px 0 0', maxWidth: '40ch', lineHeight: 1.55 }}>
        Every word in a wrap comes from a real AI call{provider ? ` to ${provider}` : ''}. Connect a provider in Settings and your wraps will start writing themselves.
      </p>
      <div style={{ display: 'flex', gap: 12, marginTop: 44, pointerEvents: 'all' }}>
        <button onClick={(e) => { e.stopPropagation(); onOpenSettings() }} style={primaryButton(REST_THEME.accent)}>Open Settings →</button>
        <button onClick={(e) => { e.stopPropagation(); onClose() }} style={ghostButton}>Dismiss</button>
      </div>
    </SlideBody>
  )
}

function MessageCard({ kicker, title, body, onClose }: { kicker: string; title: string; body?: string; onClose: () => void }) {
  return (
    <SlideBody>
      <Kicker accent={REST_THEME.accent}>{kicker}</Kicker>
      <Headline size={52}>{title}</Headline>
      {body && <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.6)', margin: '20px 0 0', maxWidth: '40ch', lineHeight: 1.55 }}>{body}</p>}
      <div style={{ display: 'flex', gap: 12, marginTop: 44, pointerEvents: 'all' }}>
        <button onClick={(e) => { e.stopPropagation(); onClose() }} style={ghostButton}>Dismiss</button>
      </div>
    </SlideBody>
  )
}

// ─── Button styles ──────────────────────────────────────────────────────────────

function primaryButton(accent: string): React.CSSProperties {
  return { padding: '13px 28px', borderRadius: 11, background: accent, color: '#06122a', fontSize: 15, fontWeight: 740, border: 'none', cursor: 'pointer', letterSpacing: '-0.01em' }
}
const ghostButton: React.CSSProperties = {
  padding: '13px 28px', borderRadius: 11, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)',
  fontSize: 15, fontWeight: 540, border: '1px solid rgba(255,255,255,0.16)', cursor: 'pointer',
}

// ─── Card model ───────────────────────────────────────────────────────────────

interface WrapCard { render: (theme: SlideTheme) => ReactNode }

type WrapState =
  | { kind: 'loading' }
  | { kind: 'needs_provider'; provider: string | null }
  | { kind: 'empty' }
  | { kind: 'ready'; cards: WrapCard[] }

// ─── Main component ───────────────────────────────────────────────────────────

export default function DayWrapped({
  data,
  threadId,
  artifactId,
  onClose,
  onOpenReport,
  onOpenSettings,
}: {
  data: DayTimelinePayload
  threadId: number | null
  artifactId: number | null
  onClose: () => void
  onOpenReport: () => void
  onOpenSettings?: () => void
  userName?: string | null
}) {
  const hasReport = threadId != null && artifactId != null
  const totals = useMemo(() => kindTotals(data), [data])
  const leisureDay = useMemo(() => isLeisureDay(totals), [totals])
  const breakdown = useMemo(() => workCategoryBreakdown(data), [data])

  // Append the weekly wrap on the evening wrap so the headline "weekly Wrapped"
  // is reachable on any day (the one test in the issue). Monthly near month-end,
  // annual in December — they read frozen snapshots, so the hero number and the
  // narrative always agree.
  const [y, m, dom] = data.date.split('-').map(Number)
  const lastOfMonth = new Date(y, m, 0).getDate()
  const periods: WrappedPeriod[] = useMemo(() => {
    const out: WrappedPeriod[] = ['week']
    if (dom >= lastOfMonth - 3) out.push('month')
    if (m === 12 && dom >= 24) out.push('year')
    return out
  }, [dom, lastOfMonth, m])

  const [provider, setProvider] = useState<WrapProviderState | null>(null)
  const [narrative, setNarrative] = useState<AIWrappedNarrative | null>(null)
  const [periodWraps, setPeriodWraps] = useState<Record<string, { facts: WrappedPeriodFacts; narrative: WrappedPeriodNarrative }>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setNarrative(null)
    setPeriodWraps({})

    void (async () => {
      const state = await ipc.ai.getWrapProviderState().catch(() => ({ connected: false, provider: null } as WrapProviderState))
      if (cancelled) return
      setProvider(state)
      if (!state.connected) { setLoaded(true); return }

      const [day, ...periodResults] = await Promise.all([
        ipc.ai.getWrappedNarrative(data.date).catch(() => null),
        ...periods.map((p) => ipc.ai.getWrappedPeriodWrap(p, data.date).catch(() => null)),
      ])
      if (cancelled) return
      setNarrative(day ?? null)
      const map: Record<string, { facts: WrappedPeriodFacts; narrative: WrappedPeriodNarrative }> = {}
      periodResults.forEach((res, i) => { if (res) map[periods[i]] = res })
      setPeriodWraps(map)
      setLoaded(true)
    })()

    return () => { cancelled = true }
  }, [data.date, periods])

  const state: WrapState = useMemo(() => {
    if (!loaded || !provider) return { kind: 'loading' }
    if (!provider.connected) return { kind: 'needs_provider', provider: provider.provider }
    if (data.totalSeconds <= 0 && Object.keys(periodWraps).length === 0) return { kind: 'empty' }

    const cards: WrapCard[] = []

    // ── Evening wrap (the day) ──
    if (narrative) {
      const lead = narrative.lead
      cards.push({ render: (t) => <ShapeCard line={lead} totals={totals} theme={t} /> })
      if (!leisureDay) {
        if (narrative.slides.topApp) {
          const worked = narrative.slides.topApp
          cards.push({ render: (t) => <TextCard kicker="What you worked on" line={worked} theme={t} /> })
        }
        if (narrative.slides.scale) {
          const where = narrative.slides.scale
          cards.push({ render: (t) => <WhereCard line={where} breakdown={breakdown} total={breakdown.reduce((s, c) => s + c.seconds, 0)} theme={t} /> })
        }
        if (narrative.nudge) {
          const thread = narrative.nudge
          cards.push({ render: (t) => <TextCard kicker="Open thread" line={thread} theme={t} /> })
        }
      }
      const closing = narrative.slides.closing ?? "That's the day."
      const hasMorePeriods = periods.some((p) => periodWraps[p])
      cards.push({ render: (t) => hasMorePeriods
        ? <TextCard kicker="That's the day" line={closing} theme={t} />
        : <CloseCard line={closing} theme={t} onClose={onClose} onOpenReport={onOpenReport} hasReport={hasReport} /> })
    }

    // ── Period wraps (week / month / year) ──
    periods.forEach((p, pi) => {
      const wrap = periodWraps[p]
      if (!wrap || wrap.facts.totalSeconds <= 0) return
      const { facts, narrative: pn } = wrap
      const isLastPeriod = pi === periods.length - 1
      cards.push({ render: (t) => <PeriodLeadCard facts={facts} line={pn.lead} theme={t} /> })
      if (pn.slides.whatMattered || facts.threads.length > 0) {
        cards.push({ render: (t) => <PeriodMatteredCard facts={facts} line={pn.slides.whatMattered} theme={t} /> })
      }
      if (pn.slides.whereTimeWent || facts.categories.length > 0) {
        cards.push({ render: (t) => <PeriodWhereCard facts={facts} line={pn.slides.whereTimeWent} theme={t} /> })
      }
      if (pn.slides.standout || facts.longestStretch || facts.busiestDay) {
        cards.push({ render: (t) => <PeriodStandoutCard facts={facts} line={pn.slides.standout} theme={t} /> })
      }
      const carrying = pn.slides.carrying
      if (carrying && isLastPeriod) {
        cards.push({ render: (t) => <PeriodCarryingCard line={carrying} theme={t} onClose={onClose} /> })
      } else if (carrying) {
        cards.push({ render: (t) => <TextCard kicker="Carrying forward" line={carrying} theme={t} /> })
      }
    })

    if (cards.length === 0) return { kind: 'empty' }
    return { kind: 'ready', cards }
  }, [loaded, provider, data.totalSeconds, narrative, totals, leisureDay, breakdown, periods, periodWraps, onClose, onOpenReport, hasReport])

  // ── Carousel nav ──
  const cardCount = state.kind === 'ready' ? state.cards.length : 1
  const [slideIndex, setSlideIndex] = useState(0)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')

  useEffect(() => { setSlideIndex(0) }, [state.kind, cardCount])

  const advance = useCallback(() => { setDirection('forward'); setSlideIndex((i) => Math.min(i + 1, cardCount - 1)) }, [cardCount])
  const goBack = useCallback(() => { setDirection('back'); setSlideIndex((i) => Math.max(i - 1, 0)) }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') advance()
      if (e.key === 'ArrowLeft') goBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, goBack, onClose])

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button')) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.clientX - rect.left < rect.width / 2) goBack()
    else advance()
  }

  const theme = WRAP_THEMES[slideIndex % WRAP_THEMES.length]
  const activeTheme = state.kind === 'ready'
    ? (leisureDay && slideIndex === 0 ? REST_THEME : slideIndex === cardCount - 1 ? CLOSE_THEME : theme)
    : REST_THEME
  const animName = direction === 'forward' ? 'wrappedEnterFromRight' : 'wrappedEnterFromLeft'

  const body: ReactNode = (() => {
    switch (state.kind) {
      case 'loading':
        return <MessageCard kicker="Wrapped" title="Writing your wrap…" onClose={onClose} />
      case 'needs_provider':
        return <ConnectProviderCard provider={state.provider} onOpenSettings={() => (onOpenSettings ? onOpenSettings() : onClose())} onClose={onClose} />
      case 'empty':
        return <MessageCard kicker="Wrapped" title="Nothing tracked yet." body="Daylens needs some activity before it can tell the story of your day." onClose={onClose} />
      case 'ready':
        return state.cards[Math.min(slideIndex, state.cards.length - 1)].render(activeTheme)
    }
  })()

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', cursor: 'default', animation: 'wrappedOverlayIn 280ms ease forwards' }}
      onClick={handleClick}
    >
      <div
        key={slideIndex}
        style={{ position: 'absolute', inset: 0, background: activeTheme.bg, animation: `${animName} 380ms cubic-bezier(0.34,1.56,0.64,1) forwards`, overflow: 'hidden' }}
      >
        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 70% 60% at 22% 42%, ${activeTheme.glow}, transparent 70%)` }} />
        {body}
      </div>

      {/* Progress bar */}
      <div style={{ position: 'absolute', top: 46, left: 16, right: 56, display: 'flex', gap: 4, zIndex: 10, pointerEvents: 'none' }}>
        {Array.from({ length: cardCount }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= slideIndex ? activeTheme.accent : 'rgba(255,255,255,0.16)', transition: 'background 300ms ease' }} />
        ))}
      </div>

      {/* Close button */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        style={{ position: 'absolute', top: 38, right: 16, zIndex: 10, width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.16)', color: 'rgba(255,255,255,0.7)', fontSize: 18, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
      >
        ×
      </button>
    </div>
  )
}
