import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AIWrappedNarrative, AppCategory, DayTimelinePayload, DistractionCostPayload, WebsiteSummary, WrappedPeriodFacts, WrappedPeriodNarrative } from '@shared/types'
import { blockActiveSeconds } from '@shared/blockDuration'
import { dateStringFromMs, dayBounds, formatTime, todayString } from '../lib/format'
import { ipc } from '../lib/ipc'
import type { BrowserContext, FocusByPeriod, IdentityConfidence, WrappedQuality } from '../lib/wrappedFacts'
import {
  buildBrowserContext,
  categoryBreakdownFromSources,
  computeFocusByPeriod,
  computeIdentityConfidence,
  computeQuality,
  selectPeakBlock,
} from '../lib/wrappedFacts'

// ─── Themes ─────────────────────────────────────────────────────────────────

interface SlideTheme { bg: string; accent: string; glow: string; hue: string }

const MORNING_VIDEO_URLS = [
  new URL('../assets/videos/morning-coffee-sunrise.mp4', import.meta.url).href,
  new URL('../assets/videos/morning-forest.mp4', import.meta.url).href,
  new URL('../assets/videos/morning-coffee-bokeh.mp4', import.meta.url).href,
  new URL('../assets/videos/morning-horizon.mp4', import.meta.url).href,
  new URL('../assets/videos/morning-hills.mp4', import.meta.url).href,
  new URL('../assets/videos/morning-hearth.mp4', import.meta.url).href,
]

const MORNING_THEMES: SlideTheme[] = [
  { bg: 'linear-gradient(158deg,#1d180f 0%,#66350d 48%,#ef9a3a 100%)', accent: '#ffd38a', glow: 'rgba(255,179,84,0.42)', hue: 'amber' },
  { bg: 'linear-gradient(144deg,#0b1820 0%,#315a56 48%,#e0a96d 100%)', accent: '#bff0dc', glow: 'rgba(191,240,220,0.28)', hue: 'sage' },
  { bg: 'linear-gradient(166deg,#251126 0%,#74393f 52%,#f2b270 100%)', accent: '#ffc7a0', glow: 'rgba(255,172,116,0.36)', hue: 'rose' },
  { bg: 'linear-gradient(136deg,#101a2a 0%,#234f74 46%,#f5c778 100%)', accent: '#b9ddff', glow: 'rgba(185,221,255,0.3)', hue: 'dawn-blue' },
]

const CAT_THEME: Partial<Record<AppCategory, SlideTheme>> = {
  development:   { bg: 'linear-gradient(150deg,#060d22 0%,#0d1c52 55%,#1a2e7a 100%)', accent: '#b4c5ff', glow: 'rgba(77,142,255,0.38)',   hue: 'blue'    },
  design:        { bg: 'linear-gradient(150deg,#150818 0%,#3d0a48 55%,#6b1280 100%)', accent: '#f472b6', glow: 'rgba(244,114,182,0.38)',  hue: 'pink'    },
  communication: { bg: 'linear-gradient(150deg,#030f0e 0%,#083830 55%,#0d5c50 100%)', accent: '#4fdbc8', glow: 'rgba(79,219,200,0.38)',   hue: 'teal'    },
  research:      { bg: 'linear-gradient(150deg,#0c0718 0%,#260865 55%,#3d0e9c 100%)', accent: '#c084fc', glow: 'rgba(192,132,252,0.38)',  hue: 'violet'  },
  writing:       { bg: 'linear-gradient(150deg,#040b1a 0%,#082060 55%,#0d3690 100%)', accent: '#93c5fd', glow: 'rgba(147,197,253,0.38)',  hue: 'blue'    },
  aiTools:       { bg: 'linear-gradient(150deg,#130618 0%,#480865 55%,#780898 100%)', accent: '#e879f9', glow: 'rgba(232,121,249,0.38)',  hue: 'magenta' },
  productivity:  { bg: 'linear-gradient(150deg,#031208 0%,#083820 55%,#0d5c32 100%)', accent: '#6ee7b7', glow: 'rgba(110,231,183,0.38)',  hue: 'green'   },
  meetings:      { bg: 'linear-gradient(150deg,#130e04 0%,#3d2206 55%,#6b3a06 100%)', accent: '#ffb95f', glow: 'rgba(255,185,95,0.38)',   hue: 'gold'    },
  email:         { bg: 'linear-gradient(150deg,#031214 0%,#084048 55%,#0d6470 100%)', accent: '#67e8f9', glow: 'rgba(103,232,249,0.38)',  hue: 'cyan'    },
  browsing:      { bg: 'linear-gradient(150deg,#140804 0%,#481806 55%,#7a2a06 100%)', accent: '#fb923c', glow: 'rgba(251,146,60,0.38)',   hue: 'orange'  },
  social:        { bg: 'linear-gradient(150deg,#0e0820 0%,#2c1870 55%,#4a2ab0 100%)', accent: '#a78bfa', glow: 'rgba(167,139,250,0.38)',  hue: 'indigo'  },
  entertainment: { bg: 'linear-gradient(150deg,#180808 0%,#5a0c0c 55%,#8c1a1a 100%)', accent: '#f87171', glow: 'rgba(248,113,113,0.38)',  hue: 'red'     },
  system:        { bg: 'linear-gradient(150deg,#080808 0%,#1a1a1a 55%,#2a2a2a 100%)', accent: '#94a3b8', glow: 'rgba(148,163,184,0.3)',   hue: 'gray'    },
  uncategorized: { bg: 'linear-gradient(150deg,#080808 0%,#1a1a1a 55%,#2a2a2a 100%)', accent: '#94a3b8', glow: 'rgba(148,163,184,0.3)',   hue: 'gray'    },
}

const DEFAULT_THEME: SlideTheme = {
  bg: 'linear-gradient(150deg,#060d1a 0%,#0d1c3a 55%,#1a2d5c 100%)',
  accent: '#adc6ff', glow: 'rgba(173,198,255,0.32)', hue: 'blue',
}

const FOCUS_THEME: SlideTheme = {
  bg: 'linear-gradient(150deg,#030f0e 0%,#083830 55%,#0d5c50 100%)',
  accent: '#4fdbc8', glow: 'rgba(79,219,200,0.38)', hue: 'teal',
}

const DISTRACTION_COST_THEME: SlideTheme = {
  bg: 'linear-gradient(150deg,#180808 0%,#5a0c0c 55%,#8c1a1a 100%)',
  accent: '#f87171', glow: 'rgba(248,113,113,0.38)', hue: 'red',
}

const DISTRACTION_PEAK_THEME: SlideTheme = {
  bg: 'linear-gradient(150deg,#140804 0%,#481806 55%,#7a2a06 100%)',
  accent: '#fb923c', glow: 'rgba(251,146,60,0.38)', hue: 'orange',
}

const DISTRACTION_IMPROVING_THEME: SlideTheme = {
  bg: 'linear-gradient(150deg,#031208 0%,#083820 55%,#0d5c32 100%)',
  accent: '#6ee7b7', glow: 'rgba(110,231,183,0.38)', hue: 'green',
}

const DISTRACTION_WORSENING_THEME: SlideTheme = DISTRACTION_COST_THEME

const DISTRACTION_FLAT_THEME: SlideTheme = {
  bg: 'linear-gradient(150deg,#130e04 0%,#3d2206 55%,#6b3a06 100%)',
  accent: '#ffb95f', glow: 'rgba(255,185,95,0.38)', hue: 'gold',
}

const SCATTERED_THEME: SlideTheme = {
  bg: 'linear-gradient(150deg,#1a0808 0%,#4a0a0a 55%,#7a1010 100%)',
  accent: '#f87171', glow: 'rgba(248,113,113,0.38)', hue: 'red',
}

const STEADY_THEME: SlideTheme = {
  bg: 'linear-gradient(150deg,#031212 0%,#094040 55%,#0f6060 100%)',
  accent: '#4fdbc8', glow: 'rgba(79,219,200,0.38)', hue: 'teal',
}

// More saturated versions for the identity slide
const IDENTITY_CAT_THEME: Partial<Record<AppCategory, SlideTheme>> = {
  development:   { bg: 'linear-gradient(150deg,#000512 0%,#070f3a 45%,#0a1860 100%)',  accent: '#7eb2ff', glow: 'rgba(77,130,255,0.55)',   hue: 'blue'    },
  design:        { bg: 'linear-gradient(150deg,#100514 0%,#350640 45%,#5e0870 100%)',  accent: '#f472b6', glow: 'rgba(244,114,182,0.55)',  hue: 'pink'    },
  communication: { bg: 'linear-gradient(150deg,#020b0a 0%,#062e28 45%,#094a42 100%)',  accent: '#34d9c4', glow: 'rgba(52,217,196,0.55)',   hue: 'teal'    },
  research:      { bg: 'linear-gradient(150deg,#080514 0%,#1e0658 45%,#320890 100%)',  accent: '#b87aff', glow: 'rgba(160,80,255,0.55)',   hue: 'violet'  },
  writing:       { bg: 'linear-gradient(150deg,#030912 0%,#061a52 45%,#092880 100%)',  accent: '#7eb8ff', glow: 'rgba(100,160,255,0.55)',  hue: 'blue'    },
  aiTools:       { bg: 'linear-gradient(150deg,#0e0414 0%,#3c0660 45%,#620878 100%)',  accent: '#e040fb', glow: 'rgba(224,64,251,0.55)',   hue: 'magenta' },
  productivity:  { bg: 'linear-gradient(150deg,#020e06 0%,#063018 45%,#0a5028 100%)',  accent: '#4ade80', glow: 'rgba(74,222,128,0.55)',   hue: 'green'   },
  meetings:      { bg: 'linear-gradient(150deg,#0e0a02 0%,#321c04 45%,#5a3006 100%)',  accent: '#f59e0b', glow: 'rgba(245,158,11,0.55)',   hue: 'gold'    },
  email:         { bg: 'linear-gradient(150deg,#020e10 0%,#063640 45%,#0a5460 100%)',  accent: '#22d3ee', glow: 'rgba(34,211,238,0.55)',   hue: 'cyan'    },
  browsing:      { bg: 'linear-gradient(150deg,#0e0602 0%,#3c1404 45%,#6a2206 100%)',  accent: '#fb923c', glow: 'rgba(251,146,60,0.55)',   hue: 'orange'  },
  social:        { bg: 'linear-gradient(150deg,#080618 0%,#22145e 45%,#3a2298 100%)',  accent: '#a78bfa', glow: 'rgba(167,139,250,0.55)',  hue: 'indigo'  },
  entertainment: { bg: 'linear-gradient(150deg,#140606 0%,#480a0a 45%,#7c1616 100%)',  accent: '#ff6b6b', glow: 'rgba(255,107,107,0.55)',  hue: 'red'     },
}

const FALLBACK_POOL: SlideTheme[] = [
  CAT_THEME.meetings!,
  CAT_THEME.productivity!,
  CAT_THEME.design!,
  CAT_THEME.browsing!,
  CAT_THEME.email!,
  CAT_THEME.social!,
  CAT_THEME.entertainment!,
  CAT_THEME.communication!,
]

function catTheme(cat: AppCategory | string | undefined): SlideTheme {
  return (cat ? CAT_THEME[cat as AppCategory] : undefined) ?? DEFAULT_THEME
}

function identityCatTheme(cat: AppCategory | string | undefined): SlideTheme {
  return (cat ? IDENTITY_CAT_THEME[cat as AppCategory] : undefined) ?? DEFAULT_THEME
}

function dedupeAdjacentThemes(themes: SlideTheme[]): SlideTheme[] {
  const result: SlideTheme[] = []
  for (let i = 0; i < themes.length; i++) {
    let t = themes[i]
    if (i > 0 && result[i - 1].hue === t.hue) {
      const prev = result[i - 1].hue
      const next = i + 1 < themes.length ? themes[i + 1].hue : ''
      const fb = FALLBACK_POOL.find(f => f.hue !== prev && f.hue !== next && f.hue !== t.hue)
      if (fb) t = fb
    }
    result.push(t)
  }
  return result
}

// ─── Identity labels ──────────────────────────────────────────────────────────

const IDENTITY: Partial<Record<AppCategory, string>> = {
  development:   'Builder',
  design:        'Creator',
  communication: 'Connector',
  research:      'Explorer',
  writing:       'Storyteller',
  aiTools:       'Augmented',
  productivity:  'Operator',
  meetings:      'Collaborator',
  email:         'Networker',
  entertainment: 'Decompressor',
  social:        'Networker',
  // browsing is intentionally excluded — browser-heavy days need domain evidence
  // before a meaningful identity can be claimed (e.g. YouTube ≠ research)
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 850): number {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (target === 0) { setVal(0); return }
    const start = performance.now()
    let raf: number
    function tick(now: number) {
      const t = Math.min((now - start) / duration, 1)
      setVal(Math.round((1 - Math.pow(1 - t, 3)) * target))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return val
}

function useAnimatedFill(target: number, delayMs = 80): number {
  const [fill, setFill] = useState(0)
  useEffect(() => {
    const id = setTimeout(() => setFill(target), delayMs)
    return () => clearTimeout(id)
  }, [target, delayMs])
  return fill
}

// ─── Derived data ─────────────────────────────────────────────────────────────

interface WrappedBlock {
  durationSeconds: number
  startTime: number
  endTime: number
  category: AppCategory
}

interface WrappedData {
  totalSeconds: number
  focusSeconds: number
  focusPct: number
  appCount: number
  blockCount: number
  peakBlock: { label: string; durationSeconds: number; startTime: number; endTime: number; category: AppCategory } | null
  topApp: { appName: string; durationSeconds: number; category: AppCategory; isBrowser: boolean } | null
  totalSwitches: number
  dominantCategory: AppCategory
  dominantCategoryPct: number
  blocks: WrappedBlock[]
  firstActivityTime: number | null
  lastActivityTime: number | null
  dayStartMs: number
  // Stage 1 additions
  quality: WrappedQuality
  switchesPerHour: number
  topDomains: WebsiteSummary[]
  identityConfidence: IdentityConfidence
  browserContext: BrowserContext | null
  // Stage 3 additions
  categoryBreakdown: { category: AppCategory; seconds: number; pct: number }[]
  focusByPeriod: FocusByPeriod
}

function deriveData(data: DayTimelinePayload): WrappedData {
  const [dayFrom] = dayBounds(data.date)

  const sortedBlocks = [...data.blocks].sort((a, b) => a.startTime - b.startTime)

  const peakBlock = selectPeakBlock(data.blocks)

  // Build isBrowser flag from block topApps (more reliable than app name matching)
  const browserFlags = new Map<string, boolean>()
  for (const b of data.blocks) {
    for (const a of b.topApps) {
      browserFlags.set(a.appName, a.isBrowser)
    }
  }

  const appMap = new Map<string, { appName: string; durationSeconds: number; category: AppCategory; isBrowser: boolean }>()
  for (const s of data.sessions) {
    const isBrowser = browserFlags.get(s.appName) ?? (s.category === 'browsing')
    const entry = appMap.get(s.appName)
    if (entry) entry.durationSeconds += s.durationSeconds
    else appMap.set(s.appName, { appName: s.appName, durationSeconds: s.durationSeconds, category: s.category, isBrowser })
  }
  const topApp = appMap.size > 0
    ? [...appMap.values()].reduce((a, b) => a.durationSeconds > b.durationSeconds ? a : b)
    : null

  const totalSwitches = data.blocks.reduce((sum, b) => sum + b.switchCount, 0)

  const categoryStats = categoryBreakdownFromSources(data.sessions, data.blocks)
  const dominantCategory = categoryStats.dominantCategory
  const dominantCategoryPct = categoryStats.dominantCategoryPct
  const categoryBreakdown = categoryStats.breakdown

  const blocks: WrappedBlock[] = sortedBlocks.map(b => ({
    durationSeconds: blockActiveSeconds(b),
    startTime: b.startTime,
    endTime: b.endTime,
    category: b.dominantCategory,
  }))

  // Stage 3: focus by period (morning / afternoon / evening)
  const focusByPeriod = computeFocusByPeriod(blocks)

  // Stage 1 fields
  const quality = computeQuality(data.totalSeconds)
  const hoursTracked = data.totalSeconds / 3600
  const switchesPerHour = hoursTracked > 0 ? Math.round(totalSwitches / hoursTracked) : 0
  const topDomains = [...data.websites].sort((a, b) => b.totalSeconds - a.totalSeconds).slice(0, 5)
  const browserContext = topApp?.isBrowser ? buildBrowserContext(topDomains) : (data.websites.length > 0 ? buildBrowserContext(topDomains) : null)
  const identityConfidence = computeIdentityConfidence(quality, data.totalSeconds, dominantCategory, dominantCategoryPct, browserContext)

  return {
    totalSeconds: data.totalSeconds,
    focusSeconds: data.focusSeconds,
    focusPct: data.focusPct,
    appCount: data.appCount,
    blockCount: data.blocks.length,
    peakBlock, topApp, totalSwitches,
    dominantCategory, dominantCategoryPct,
    blocks,
    firstActivityTime: sortedBlocks.length > 0
      ? sortedBlocks[0].startTime
      : data.sessions.length > 0 ? Math.min(...data.sessions.map(s => s.startTime)) : null,
    lastActivityTime: sortedBlocks.length > 0
      ? sortedBlocks[sortedBlocks.length - 1].endTime
      : data.sessions.length > 0 ? Math.max(...data.sessions.map(s => s.startTime + s.durationSeconds * 1000)) : null,
    dayStartMs: dayFrom,
    quality,
    switchesPerHour,
    topDomains,
    identityConfidence,
    browserContext,
    categoryBreakdown,
    focusByPeriod,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dateMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function isPastLocalDate(dateStr: string): boolean {
  return dateMs(dateStr) < dateMs(todayString())
}

function dateVariant(dateStr: string, modulo: number): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const current = new Date(y, m - 1, d)
  const yearStart = new Date(y, 0, 1)
  const dayOfYear = Math.floor((current.getTime() - yearStart.getTime()) / 86_400_000)
  return Math.abs((y * 37 + dayOfYear) % modulo)
}

function rotateGradientForDate(theme: SlideTheme, dateStr: string): SlideTheme {
  const angle = 142 + dateVariant(dateStr, 9) * 4
  return {
    ...theme,
    bg: theme.bg.replace(/linear-gradient\(\d+deg/, `linear-gradient(${angle}deg`),
  }
}

function formatDurationShort(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${Math.max(1, m)}m`
}

function humanComparison(seconds: number): string {
  const h = seconds / 3600
  if (h >= 8) return "That's more than a full workday."
  if (h >= 7) return "More than most people sleep."
  if (h >= 5) return "Longer than most movies, twice over."
  if (h >= 3) return "Longer than most films."
  if (h >= 2) return "More than a lunch break and a commute."
  if (h >= 1) return "A solid hour of focused attention."
  return "A short but intentional stretch."
}

function generateTeaser(d: WrappedData): string {
  if (d.quality === 'empty' || d.quality === 'tooEarly') return 'Not enough data yet for a full story.'
  const h = Math.floor(d.totalSeconds / 3600)
  if (d.focusPct > 70) {
    return `You found your flow and stayed there — ${h} hours of mostly clear signal.`
  }
  if (d.totalSwitches > 20) {
    const rate = d.switchesPerHour
    return `A scattered day — ${rate} context switch${rate !== 1 ? 'es' : ''} per hour, but some interesting patterns in the noise.`
  }
  if (d.peakBlock) {
    const start = formatTime(d.peakBlock.startTime)
    const end = formatTime(d.peakBlock.endTime)
    return `Your best stretch ran ${start} to ${end}. The rest of the day tells a different story.`
  }
  if (d.browserContext && !d.browserContext.isWorkRelevant) {
    return `${formatDurationShort(d.totalSeconds)} tracked. ${d.browserContext.interpretation}`
  }
  return `${h > 0 ? `${h}h` : formatDurationShort(d.totalSeconds)} tracked across ${d.blockCount} block${d.blockCount !== 1 ? 's' : ''}.`
}

// ─── Layout ───────────────────────────────────────────────────────────────────

function SlideLeft({ children }: { children: ReactNode }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      alignItems: 'flex-start', padding: '88px 64px 60px',
      pointerEvents: 'none',
    }}>
      {children}
    </div>
  )
}

function SlideCenter({ children }: { children: ReactNode }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      alignItems: 'center', textAlign: 'center', padding: '88px 48px 60px',
      pointerEvents: 'none',
    }}>
      {children}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function GlowBar({ pct, accent, glow }: { pct: number; accent: string; glow: string }) {
  const fill = useAnimatedFill(pct)
  return (
    <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{
        width: `${fill}%`, height: '100%',
        background: `linear-gradient(90deg, ${accent}55, ${accent})`,
        borderRadius: 2,
        boxShadow: `0 0 16px ${glow}`,
        transition: 'width 1.3s cubic-bezier(0.16,1,0.3,1)',
      }} />
    </div>
  )
}

// ─── Slides ───────────────────────────────────────────────────────────────────

function SlideScale({ d, theme, aiLine = null }: { d: WrappedData; theme: SlideTheme; aiLine?: string | null }) {
  const hours = useCountUp(Math.floor(d.totalSeconds / 3600))
  const mins  = useCountUp(Math.floor((d.totalSeconds % 3600) / 60))
  const pct   = Math.min(100, Math.round((d.totalSeconds / (16 * 3600)) * 100))
  const first = d.firstActivityTime ? formatTime(d.firstActivityTime) : null
  const last  = d.lastActivityTime  ? formatTime(d.lastActivityTime)  : null
  const subtitle = aiLine ?? 'tracked today.'

  return (
    <SlideLeft>
      <h1 style={{
        fontSize: 108, fontWeight: 900, lineHeight: 1,
        letterSpacing: '-0.035em', color: '#fff',
        margin: 0,
      }}>
        <span style={{ color: theme.accent }}>{hours}h {mins}m</span>
      </h1>
      <p style={{ fontSize: aiLine ? 19 : 22, fontWeight: 400, color: 'rgba(255,255,255,0.55)', margin: '12px 0 32px', letterSpacing: '-0.01em', lineHeight: 1.45, maxWidth: '38ch' }}>
        {subtitle}
      </p>

      <div style={{ width: '100%', marginBottom: 24 }}>
        <GlowBar pct={pct} accent={theme.accent} glow={theme.glow} />
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', marginTop: 8, margin: '6px 0 0', letterSpacing: '0.04em' }}>
          {pct}% of a 16-hour day
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.38)', margin: 0, letterSpacing: '-0.01em' }}>
          <span style={{ color: 'rgba(255,255,255,0.72)', fontWeight: 600 }}>{d.appCount}</span>
          {' '}app{d.appCount !== 1 ? 's' : ''}
          <span style={{ opacity: 0.4 }}> · </span>
          <span style={{ color: 'rgba(255,255,255,0.72)', fontWeight: 600 }}>{d.blockCount}</span>
          {' '}work session{d.blockCount !== 1 ? 's' : ''}
          {first && (
            <>
              <span style={{ opacity: 0.4 }}> · </span>
              <span style={{ color: 'rgba(255,255,255,0.72)', fontWeight: 600 }}>{first}</span>
              {last && last !== first && (
                <>
                  {' – '}
                  <span style={{ color: 'rgba(255,255,255,0.72)', fontWeight: 600 }}>{last}</span>
                </>
              )}
            </>
          )}
        </p>
      </div>
    </SlideLeft>
  )
}

function SlideFocus({ d, theme, aiLine = null }: { d: WrappedData; theme: SlideTheme; aiLine?: string | null }) {
  const pct    = useCountUp(d.focusPct)
  const focusH = useCountUp(Math.floor(d.focusSeconds / 3600))
  const focusM = useCountUp(Math.floor((d.focusSeconds % 3600) / 60))
  const noFocus = d.focusSeconds < 60

  const maxDur = Math.max(...d.blocks.map(b => b.durationSeconds), 1)
  const pills  = d.blocks.slice(0, 24)

  // Stage 3: focus timing copy
  const peak = d.focusByPeriod.peakPeriod
  const peakCopy = !noFocus && peak ? (
    peak === 'morning' ? 'The strongest focus signal came in the morning.'
    : peak === 'afternoon' ? 'The strongest focus signal came in the afternoon.'
    : 'Your clearest work came in the evening.'
  ) : null

  return (
    <SlideLeft>
      {noFocus ? (
        <h1 style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.025em', color: '#fff', margin: 0 }}>
          Mostly<br />exploratory<br />work today.
        </h1>
      ) : (
        <h1 style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.025em', color: '#fff', margin: 0 }}>
          Marked focused{' '}
          <span style={{ color: theme.accent }}>{pct}%</span>
          <br />of the time.
        </h1>
      )}
      {!noFocus && (
        <p style={{ fontSize: 18, fontWeight: 400, lineHeight: 1.55, color: 'rgba(255,255,255,0.55)', marginTop: 20, maxWidth: '42ch' }}>
          {aiLine ?? (
            <>
              {focusH > 0 ? `${focusH}h ` : ''}{focusM}m matched Daylens' focus signal.
              {peakCopy && <span style={{ color: 'rgba(255,255,255,0.35)' }}> {peakCopy}</span>}
            </>
          )}
        </p>
      )}
      {pills.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, marginTop: 32, flexWrap: 'wrap', maxWidth: 380 }}>
          {pills.map((b, i) => {
            const rel = b.durationSeconds / maxDur
            const w   = Math.round(8 + rel * 40)
            return (
              <div key={i} style={{
                width: w, height: 8, borderRadius: 4,
                background: theme.accent,
                opacity: 0.18 + rel * 0.72,
              }} />
            )
          })}
        </div>
      )}
    </SlideLeft>
  )
}

function SlidePeakBlock({ d, theme, aiInsight = null }: { d: WrappedData; theme: SlideTheme; aiInsight?: string | null }) {
  const dur = d.peakBlock?.durationSeconds ?? 0
  const h   = useCountUp(Math.floor(dur / 3600))
  const m   = useCountUp(Math.floor((dur % 3600) / 60))

  if (!d.peakBlock) {
    return (
      <SlideLeft>
        <h1 style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.025em', color: '#fff', margin: 0 }}>
          Keep going.
        </h1>
        <p style={{ fontSize: 18, fontWeight: 400, color: 'rgba(255,255,255,0.5)', marginTop: 20 }}>
          No long work blocks recorded today.
        </p>
      </SlideLeft>
    )
  }

  const { label, startTime, endTime, category } = d.peakBlock
  const fs = label.length > 22 ? 44 : label.length > 14 ? 56 : 72
  const blockKind = category === 'aiTools'
    ? 'of AI-assisted work'
    : category === 'productivity'
      ? 'of admin/productivity work'
      : category === 'development'
        ? 'of development signal'
        : 'in one meaningful stretch'

  const TL_START = d.dayStartMs + 6 * 3600 * 1000
  const TL_END   = d.dayStartMs + 24 * 3600 * 1000
  const TL_RANGE = TL_END - TL_START

  return (
    <SlideLeft>
      <h1 style={{ fontSize: fs, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.025em', color: theme.accent, margin: 0 }}>
        {label}
      </h1>
      <p style={{ fontSize: 18, fontWeight: 400, color: 'rgba(255,255,255,0.55)', marginTop: 20, lineHeight: 1.55, maxWidth: '42ch' }}>
        <span style={{ color: '#fff', fontWeight: 600 }}>
          {h > 0 ? `${h}h ` : ''}{m}m
        </span>
        {' '}{blockKind} · {formatTime(startTime)}–{formatTime(endTime)}
      </p>
      {aiInsight && (
        <p style={{ fontSize: 16, fontWeight: 400, color: 'rgba(255,255,255,0.45)', marginTop: 12, lineHeight: 1.6, maxWidth: '42ch', fontStyle: 'italic' }}>
          {aiInsight}
        </p>
      )}

      <div style={{ width: '100%', marginTop: 36 }}>
        <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
          {d.blocks.map((b, i) => {
            const bLeft  = Math.max(0, ((b.startTime - TL_START) / TL_RANGE) * 100)
            const bWidth = Math.max(0.5, ((b.endTime - b.startTime) / TL_RANGE) * 100)
            return (
              <div key={i} style={{
                position: 'absolute',
                left: `${bLeft}%`, width: `${bWidth}%`,
                top: 0, bottom: 0,
                background: 'rgba(255,255,255,0.15)',
                borderRadius: 2,
              }} />
            )
          })}
          {(() => {
            const left  = Math.max(0, ((startTime - TL_START) / TL_RANGE) * 100)
            const width = Math.max(1, ((endTime - startTime) / TL_RANGE) * 100)
            return (
              <div style={{
                position: 'absolute',
                left: `${left}%`, width: `${width}%`,
                top: 0, bottom: 0,
                background: theme.accent,
                borderRadius: 2,
                boxShadow: `0 0 10px ${theme.glow}`,
              }} />
            )
          })()}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7, fontSize: 11, color: 'rgba(255,255,255,0.24)', letterSpacing: '0.04em' }}>
          <span>6 AM</span>
          <span>12 PM</span>
          <span>6 PM</span>
          <span>12 AM</span>
        </div>
      </div>
    </SlideLeft>
  )
}

function SlideTopApp({ d, theme, aiLine = null }: { d: WrappedData; theme: SlideTheme; aiLine?: string | null }) {
  const totalSec = d.topApp?.durationSeconds ?? 0
  const h = useCountUp(Math.floor(totalSec / 3600))
  const m = useCountUp(Math.floor((totalSec % 3600) / 60))
  const name = d.topApp?.appName ?? '—'
  const fs = name.length > 18 ? 44 : name.length > 12 ? 56 : name.length > 7 ? 72 : 88
  const isBrowserTop = d.topApp?.isBrowser ?? false
  const ctx = isBrowserTop ? d.browserContext : null

  return (
    <SlideLeft>
      <h1 style={{ fontSize: fs, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.025em', color: theme.accent, margin: 0 }}>
        {name}
      </h1>
      {d.topApp && (
        <>
          <p style={{ fontSize: 18, fontWeight: 400, color: 'rgba(255,255,255,0.5)', marginTop: 20 }}>
            <span style={{ color: '#fff', fontWeight: 600 }}>
              {h > 0 ? `${h}h ` : ''}{m}m
            </span>
            {' '}here today.
          </p>
          {aiLine ? (
            <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.55)', marginTop: 12, lineHeight: 1.6, maxWidth: '42ch' }}>
              {aiLine}
            </p>
          ) : ctx ? (
            <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)', marginTop: 10, lineHeight: 1.55 }}>
              {ctx.interpretation}
            </p>
          ) : (
            <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)', marginTop: 10, fontStyle: 'italic' }}>
              {humanComparison(totalSec)}
            </p>
          )}
          {ctx && d.topDomains.length > 1 && (
            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {d.topDomains.slice(0, 3).map((site) => {
                const dh = Math.floor(site.totalSeconds / 3600)
                const dm = Math.floor((site.totalSeconds % 3600) / 60)
                const dur = dh > 0 ? `${dh}h ${dm}m` : `${dm}m`
                return (
                  <p key={site.domain} style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)', margin: 0, letterSpacing: '-0.01em' }}>
                    <span style={{ color: 'rgba(255,255,255,0.65)', fontWeight: 500 }}>{site.domain}</span>
                    <span style={{ opacity: 0.5 }}> · </span>
                    {dur}
                  </p>
                )
              })}
            </div>
          )}
        </>
      )}
    </SlideLeft>
  )
}

function SlideContextSwitching({ d, theme, aiLine = null }: { d: WrappedData; theme: SlideTheme; aiLine?: string | null }) {
  const switches    = useCountUp(d.totalSwitches)
  const perHour     = d.switchesPerHour
  const noisySignal = d.totalSwitches > d.blockCount * 6 || perHour > 18
  const isScattered = !noisySignal && (perHour > 12 || d.totalSwitches > 20)
  const isBalanced  = !isScattered && (perHour >= 4 || d.totalSwitches >= 5)

  const headline = noisySignal
    ? <>A busy,<br />fragmented<br />day.</>
    : isScattered
    ? <>You were<br />all over<br />the place.</>
    : isBalanced
      ? <>You balanced<br />focus with<br />flexibility.</>
      : <>You stayed<br />in flow.</>

  const visible = d.blocks.slice(0, 40)
  const extra   = d.blocks.length - visible.length

  return (
    <SlideLeft>
      <h1 style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.025em', color: '#fff', margin: 0 }}>
        {headline}
      </h1>
      <p style={{ fontSize: 18, fontWeight: 400, color: 'rgba(255,255,255,0.55)', marginTop: 20, lineHeight: 1.55, maxWidth: '42ch' }}>
        {aiLine ?? (
          noisySignal ? (
            <>
              The switching signal was noisy, with <span style={{ color: theme.accent, fontWeight: 600 }}>{d.blockCount}</span>
              {' '}work session{d.blockCount !== 1 ? 's' : ''} reconstructed.
            </>
          ) : (
            <>
              <span style={{ color: theme.accent, fontWeight: 600 }}>{switches}</span>
              {' '}context switch{d.totalSwitches !== 1 ? 'es' : ''} across{' '}
              {d.blockCount} session{d.blockCount !== 1 ? 's' : ''}.
              {perHour > 0 && (
                <span style={{ color: 'rgba(255,255,255,0.35)' }}> · {perHour}/hr</span>
              )}
            </>
          )
        )}
      </p>
      {visible.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 28, maxWidth: 340 }}>
          {visible.map((b, i) => (
            <div key={i} style={{
              width: 12, height: 12, borderRadius: 3,
              background: CAT_THEME[b.category]?.accent ?? DEFAULT_THEME.accent,
              opacity: 0.82,
            }} />
          ))}
          {extra > 0 && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', alignSelf: 'center', marginLeft: 2 }}>
              +{extra}
            </span>
          )}
        </div>
      )}
    </SlideLeft>
  )
}

function SlideCategoryIdentity({ d, theme, morning = false, aiLine = null }: { d: WrappedData; theme: SlideTheme; morning?: boolean; aiLine?: string | null }) {
  const pct      = useCountUp(d.dominantCategoryPct, 1100)
  const rawIdentity = IDENTITY[d.dominantCategory]
  const catLabel = d.dominantCategory === 'aiTools' ? 'AI tools' : d.dominantCategory

  // Confidence-aware identity label
  const identity: string = (() => {
    if (d.identityConfidence === 'none' || d.identityConfidence === 'low') {
      // No strong identity — use a soft alternative
      if (d.totalSeconds < 60 * 60) return 'Light day'
      if (d.dominantCategoryPct < 30) return 'Mixed day'
      if (d.dominantCategory === 'browsing') {
        if (d.browserContext?.isWorkRelevant) return 'Browser-led'
        return 'Mostly browsing'
      }
      return rawIdentity ?? 'Mixed day'
    }
    if (d.dominantCategory === 'browsing') {
      return d.browserContext?.isWorkRelevant ? 'Browser-led' : 'Heavy browser'
    }
    return rawIdentity ?? 'Mixed day'
  })()

  const fs = identity.length <= 6 ? 144 : identity.length <= 8 ? 120 : identity.length <= 10 ? 96 : identity.length <= 14 ? 76 : 56

  const GRAIN = `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.12'/%3E%3C/svg%3E")`

  // Soft copy when confidence is low. AI line wins when present and confidence is high.
  const fallbackCopy = d.identityConfidence === 'none' || d.identityConfidence === 'low' ? (
    d.dominantCategory === 'browsing' && d.browserContext
      ? d.browserContext.interpretation
      : `Not enough signal to pin down a clear role for the day.`
  ) : (
    <>
      <span style={{ color: theme.accent, fontWeight: 600 }}>{pct}%</span>
      {morning ? ` of yesterday was ${catLabel}.` : ` of your day was ${catLabel}.`}
    </>
  )
  const subCopy = aiLine && (d.identityConfidence === 'high' || d.identityConfidence === 'medium') ? aiLine : fallbackCopy

  return (
    <SlideCenter>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 72% 60% at 50% 50%, ${theme.glow}, transparent 72%)` }} />
      <div style={{ position: 'absolute', inset: 0, backgroundImage: GRAIN, backgroundSize: '256px 256px', opacity: 0.06, mixBlendMode: 'overlay' }} />

      <div style={{ position: 'relative', userSelect: 'none' }}>
        {(d.identityConfidence === 'high' || d.identityConfidence === 'medium') && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: fs * 2.2, fontWeight: 900,
            color: theme.accent, opacity: 0.04,
            letterSpacing: '-0.05em', whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}>
            {identity}
          </div>
        )}
        <h1 style={{
          fontSize: fs, fontWeight: 900, lineHeight: 1,
          letterSpacing: '-0.04em', color: theme.accent,
          margin: '0 0 28px', position: 'relative',
          textShadow: `0 0 80px ${theme.glow}`,
          animation: 'wrappedIdentityBounce 600ms cubic-bezier(0.34,1.56,0.64,1) forwards',
        }}>
          {identity}
        </h1>
      </div>

      <p style={{ fontSize: 18, fontWeight: 400, color: 'rgba(255,255,255,0.5)', position: 'relative' }}>
        {subCopy}
      </p>
    </SlideCenter>
  )
}

function SlideCTA({ d, onClose, onOpenReport, hasReport, aiTeaser, aiClosing = null }: {
  d: WrappedData
  onClose: () => void
  onOpenReport: () => void
  hasReport: boolean
  aiTeaser: string | null
  aiClosing?: string | null
}) {
  const teaser = aiClosing ?? aiTeaser ?? generateTeaser(d)
  return (
    <SlideLeft>
      <h1 style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.025em', color: '#fff', margin: 0 }}>
        {hasReport ? <>Your report<br />is ready.</> : <>Your day<br />is wrapped.</>}
      </h1>
      <p style={{ fontSize: 17, fontWeight: 400, color: 'rgba(255,255,255,0.5)', marginTop: 22, fontStyle: 'italic', maxWidth: '42ch', lineHeight: 1.6 }}>
        "{teaser}"
      </p>
      <div style={{ display: 'flex', gap: 12, marginTop: 44, pointerEvents: 'all' }}>
        {hasReport && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenReport() }}
            style={{
              padding: '13px 28px', borderRadius: 10,
              background: '#adc6ff', color: '#001a42',
              fontSize: 15, fontWeight: 700, border: 'none', cursor: 'pointer',
              letterSpacing: '-0.01em',
            }}
          >
            Open Report →
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onClose() }}
          style={{
            padding: '13px 28px', borderRadius: 10,
            background: 'rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.65)',
            fontSize: 15, fontWeight: 500,
            border: '1px solid rgba(255,255,255,0.14)',
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
      </div>
    </SlideLeft>
  )
}

// ─── Empty and partial state slides ──────────────────────────────────────────

function SlideEmpty({ onClose }: { onClose: () => void }) {
  return (
    <SlideLeft>
      <h1 style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.025em', color: '#fff', margin: 0 }}>
        Nothing tracked yet.
      </h1>
      <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.45)', marginTop: 20, maxWidth: '36ch', lineHeight: 1.6 }}>
        Daylens needs some activity before it can tell the story of your day.
      </p>
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        style={{
          marginTop: 40, padding: '13px 28px', borderRadius: 10,
          background: 'rgba(255,255,255,0.08)',
          color: 'rgba(255,255,255,0.65)',
          fontSize: 15, fontWeight: 500,
          border: '1px solid rgba(255,255,255,0.14)',
          cursor: 'pointer', pointerEvents: 'all',
        }}
      >
        Dismiss
      </button>
    </SlideLeft>
  )
}

function SlideTooEarly({ d, theme, onClose }: { d: WrappedData; theme: SlideTheme; onClose: () => void }) {
  const dur = formatDurationShort(d.totalSeconds)
  return (
    <SlideLeft>
      <h1 style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.025em', color: '#fff', margin: 0 }}>
        Too early to tell.
      </h1>
      <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.45)', marginTop: 20, maxWidth: '36ch', lineHeight: 1.6 }}>
        Daylens has only tracked{' '}
        <span style={{ color: theme.accent, fontWeight: 600 }}>{dur}</span>{' '}
        so far. Check back after a real session.
      </p>
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        style={{
          marginTop: 40, padding: '13px 28px', borderRadius: 10,
          background: 'rgba(255,255,255,0.08)',
          color: 'rgba(255,255,255,0.65)',
          fontSize: 15, fontWeight: 500,
          border: '1px solid rgba(255,255,255,0.14)',
          cursor: 'pointer', pointerEvents: 'all',
        }}
      >
        Dismiss
      </button>
    </SlideLeft>
  )
}

function morningLead(d: WrappedData, aiTeaser: string | null): string {
  if (aiTeaser) return aiTeaser
  if (d.quality === 'empty' || d.quality === 'tooEarly') return 'Not much was tracked yesterday, so the signal is thin. Start fresh today.'
  if (d.focusPct >= 65) return `Yesterday, ${d.focusPct}% of your tracked time stayed focused. That is a clean signal to protect today.`
  if (d.peakBlock && d.peakBlock.durationSeconds >= 45 * 60) {
    return `Your clearest stretch ran ${formatTime(d.peakBlock.startTime)} to ${formatTime(d.peakBlock.endTime)}. That window is worth defending.`
  }
  if (d.browserContext && !d.browserContext.isWorkRelevant) {
    return `Yesterday leaned heavy on the browser. ${d.browserContext.interpretation} Start today with a clear thread.`
  }
  if (d.totalSeconds >= 5 * 3600) return `You tracked ${formatDurationShort(d.totalSeconds)} yesterday across ${d.blockCount} work session${d.blockCount !== 1 ? 's' : ''}.`
  if (d.topApp) return `${d.topApp.appName} carried the strongest signal yesterday. The full recap has the shape of the day.`
  return 'Yesterday left enough signal for a useful read on what to carry into today.'
}

function morningNudge(d: WrappedData, aiNudge: string | null): string {
  if (aiNudge) return aiNudge
  if (d.quality === 'empty' || d.quality === 'tooEarly') return 'Name the one thing you most want to finish today before anything else.'
  if (d.peakBlock && d.peakBlock.durationSeconds >= 45 * 60) {
    return `You hit flow around ${formatTime(d.peakBlock.startTime)} yesterday. Block that window today.`
  }
  if (d.focusPct >= 60) return 'Yesterday had a clean focus pattern. Give the first quiet hour of today a real boundary.'
  if (d.switchesPerHour > 12) return 'Yesterday was switch-heavy. Start today by naming the one thread that gets your best attention.'
  return 'Start with the workstream that would make the rest of the day easier.'
}

function SlideMorningGreeting({
  d,
  userName,
  aiTeaser,
}: {
  d: WrappedData
  userName: string | null
  aiTeaser: string | null
}) {
  const name = userName?.trim()
  return (
    <SlideLeft>
      <h1 style={{
        fontSize: name ? 72 : 68,
        fontWeight: 860,
        lineHeight: 1.02,
        letterSpacing: '-0.03em',
        color: '#fffaf0',
        margin: 0,
        textShadow: '0 14px 48px rgba(0,0,0,0.42)',
      }}>
        {name ? `Good morning, ${name}.` : 'Good morning.'}
      </h1>
      <p style={{
        fontSize: 22,
        fontWeight: 430,
        lineHeight: 1.55,
        color: 'rgba(255,250,240,0.72)',
        margin: '24px 0 0',
        maxWidth: '42ch',
        textShadow: '0 10px 32px rgba(0,0,0,0.5)',
      }}>
        {morningLead(d, aiTeaser)}
      </p>
    </SlideLeft>
  )
}

function SlideMorningNudge({ d, aiNudge }: { d: WrappedData; aiNudge: string | null }) {
  return (
    <SlideLeft>
      <p style={{
        fontSize: 38,
        fontWeight: 620,
        lineHeight: 1.22,
        letterSpacing: '-0.018em',
        fontStyle: 'italic',
        color: '#fff7e8',
        margin: 0,
        maxWidth: '18ch',
        textShadow: '0 22px 70px rgba(67,31,5,0.42)',
      }}>
        {morningNudge(d, aiNudge)}
      </p>
    </SlideLeft>
  )
}

function SlideMorningClose({
  hasReport,
  aiTeaser,
  onClose,
  onOpenReport,
}: {
  hasReport: boolean
  aiTeaser: string | null
  onClose: () => void
  onOpenReport: () => void
}) {
  return (
    <SlideLeft>
      <h1 style={{
        fontSize: 76,
        fontWeight: 840,
        lineHeight: 1.04,
        letterSpacing: '-0.03em',
        color: '#fff8ec',
        margin: 0,
        maxWidth: '11ch',
      }}>
        {hasReport ? 'Your full recap is ready.' : "Yesterday's recap is waiting."}
      </h1>
      {hasReport && aiTeaser && (
        <p style={{ fontSize: 17, fontWeight: 430, color: 'rgba(255,248,236,0.62)', marginTop: 22, fontStyle: 'italic', maxWidth: '42ch', lineHeight: 1.6 }}>
          "{aiTeaser}"
        </p>
      )}
      <div style={{ display: 'flex', gap: 12, marginTop: 42, pointerEvents: 'all' }}>
        {hasReport && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenReport() }}
            style={{
              padding: '13px 28px', borderRadius: 12,
              background: 'linear-gradient(145deg,#1a6fd4 0%,#5ab3ff 100%)',
              color: '#061225',
              fontSize: 15, fontWeight: 760, border: 'none', cursor: 'pointer',
              boxShadow: '0 18px 40px rgba(26,111,212,0.28)',
            }}
          >
            See yesterday →
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onClose() }}
          style={{
            padding: '13px 28px', borderRadius: 12,
            background: 'rgba(255,255,255,0.08)',
            color: 'rgba(255,248,236,0.72)',
            fontSize: 15, fontWeight: 540,
            border: '1px solid rgba(255,255,255,0.16)',
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
      </div>
    </SlideLeft>
  )
}

// ─── Distraction Cost ─────────────────────────────────────────────────────────

function useDistractionCost(): DistractionCostPayload | null {
  const [data, setData] = useState<DistractionCostPayload | null>(null)
  useEffect(() => {
    ipc.db.getDistractionCost().then(setData).catch(() => {})
  }, [])
  return data
}

function distractionComparisons(totalHours: number): string[] {
  if (totalHours < 0.5) return []
  const books = Math.round(totalHours / 2.5)
  const courses = Math.round(totalHours / 8)
  const sleep = Math.round(totalHours / 8)
  const workdays = (totalHours / 8).toFixed(1)
  const results: string[] = []
  if (books >= 1) results.push(`${books} book${books !== 1 ? 's' : ''} you didn't read`)
  if (courses >= 1) results.push(`${courses} course${courses !== 1 ? 's' : ''} left unstarted`)
  if (sleep >= 1) results.push(`${sleep} night${sleep !== 1 ? 's' : ''} of full sleep`)
  results.push(`${workdays} full workday${workdays === '1.0' ? '' : 's'} gone`)
  return results.slice(0, 3)
}

function SlideDistractionCost({ cost, theme }: { cost: DistractionCostPayload; theme: SlideTheme }) {
  const totalH = Math.floor(cost.totalDistractionSeconds / 3600)
  const totalM = Math.floor((cost.totalDistractionSeconds % 3600) / 60)
  const annualH = Math.floor(cost.annualExtrapolatedSeconds / 3600)
  const wakingPct = Math.round((cost.totalDistractionSeconds / (30 * 16 * 3600)) * 100)
  const animPct = useAnimatedFill(wakingPct)
  const countH = useCountUp(totalH)
  const countM = useCountUp(totalM)
  const comparisons = distractionComparisons(cost.totalDistractionSeconds / 3600)

  return (
    <SlideLeft>
      <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.35)', margin: '0 0 12px', textTransform: 'uppercase' }}>
        30-day distraction cost
      </p>
      <h1 style={{ fontSize: 96, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.035em', color: '#fff', margin: 0 }}>
        <span style={{ color: theme.accent }}>{countH}h {countM}m</span>
      </h1>
      <p style={{ fontSize: 20, fontWeight: 400, color: 'rgba(255,255,255,0.4)', margin: '8px 0 28px', letterSpacing: '-0.01em' }}>
        lost to distractions.
      </p>

      <div style={{ width: '100%', marginBottom: 28 }}>
        <GlowBar pct={animPct} accent={theme.accent} glow={theme.glow} />
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', marginTop: 6, letterSpacing: '0.04em' }}>
          {wakingPct}% of waking hours across 30 days
        </p>
      </div>

      {comparisons.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {comparisons.map((c, i) => (
            <p key={i} style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', margin: 0, letterSpacing: '-0.01em' }}>
              <span style={{ color: theme.accent, fontWeight: 600 }}>·</span> {c}
            </p>
          ))}
        </div>
      )}

      {annualH > 0 && (
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.22)', marginTop: 24, letterSpacing: '-0.01em' }}>
          Extrapolated: ~{annualH}h this year
        </p>
      )}
    </SlideLeft>
  )
}

function SlideDistractionTrend({ cost, theme }: { cost: DistractionCostPayload; theme: SlideTheme }) {
  const maxSec = Math.max(...cost.byMonth.map(m => m.totalSeconds), 1)

  const headline =
    cost.trendDirection === 'improving' ? "Getting better." :
    cost.trendDirection === 'worsening' ? "Getting worse." :
    "Holding steady."

  const prevH = Math.floor(cost.previousPeriodSeconds / 3600)
  const currH = Math.floor(cost.totalDistractionSeconds / 3600)
  const diffH = Math.abs(currH - prevH)

  const caption = cost.previousPeriodSeconds === 0 ? null :
    cost.trendDirection === 'improving' ? `Down ${diffH}h from the previous 30 days.` :
    cost.trendDirection === 'worsening' ? `Up ${diffH}h from the previous 30 days.` :
    'About the same as the previous 30 days.'

  return (
    <SlideLeft>
      <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.35)', margin: '0 0 12px', textTransform: 'uppercase' }}>
        Monthly trend
      </p>
      <h1 style={{ fontSize: 66, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.025em', color: '#fff', margin: 0 }}>
        {headline}
      </h1>
      {caption && (
        <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.4)', marginTop: 12, letterSpacing: '-0.01em' }}>
          {caption}
        </p>
      )}

      {cost.byMonth.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 36, height: 100 }}>
          {cost.byMonth.map((m, i) => {
            const rel = m.totalSeconds / maxSec
            const barH = Math.max(4, Math.round(rel * 84))
            const isLast = i === cost.byMonth.length - 1
            const [, monthNum] = m.month.split('-')
            const monthLabel = new Date(2000, parseInt(monthNum, 10) - 1, 1)
              .toLocaleDateString('en-US', { month: 'short' })
            return (
              <div key={m.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1 }}>
                <div style={{
                  width: '100%', height: barH, borderRadius: 4,
                  background: theme.accent,
                  opacity: isLast ? 1 : 0.35,
                  boxShadow: isLast ? `0 0 14px ${theme.glow}` : 'none',
                  transition: `height 0.9s ${i * 0.08}s cubic-bezier(0.16,1,0.3,1)`,
                }} />
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.04em', fontWeight: isLast ? 700 : 400 }}>
                  {monthLabel}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </SlideLeft>
  )
}

function SlideDistractionPeak({ cost, theme }: { cost: DistractionCostPayload; theme: SlideTheme }) {
  const topDomains = cost.byDomain.slice(0, 4)
  const maxDomainSec = Math.max(...topDomains.map(d => d.totalSeconds), 1)

  const peakLabel = cost.peakHour !== null ? (() => {
    const h = cost.peakHour
    const start = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`
    const end = (h + 1) === 12 ? '12pm' : (h + 1) > 12 ? `${h - 11}pm` : `${h + 1}am`
    return `${start} – ${end}`
  })() : null

  const maxHourSec = Math.max(...cost.byHour.map(h => h.totalSeconds), 1)
  const hourDots = Array.from({ length: 24 }, (_, i) => {
    const entry = cost.byHour.find(h => h.hour === i)
    const opacity = entry ? 0.15 + (entry.totalSeconds / maxHourSec) * 0.85 : 0.08
    return { hour: i, opacity }
  })

  return (
    <SlideLeft>
      <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.35)', margin: '0 0 12px', textTransform: 'uppercase' }}>
        Peak distraction window
      </p>

      {peakLabel ? (
        <>
          <h1 style={{ fontSize: 72, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.03em', color: theme.accent, margin: 0 }}>
            {peakLabel}
          </h1>
          <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.4)', margin: '8px 0 28px', letterSpacing: '-0.01em' }}>
            your peak distraction hour
          </p>
        </>
      ) : (
        <h1 style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.025em', color: '#fff', margin: '0 0 28px' }}>
          No clear peak yet.
        </h1>
      )}

      {/* 24-hour heatmap */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 28, width: '100%' }}>
        {hourDots.map(({ hour, opacity }) => (
          <div
            key={hour}
            title={`${hour}:00`}
            style={{
              flex: 1, height: 8, borderRadius: 2,
              background: theme.accent,
              opacity,
            }}
          />
        ))}
      </div>

      {topDomains.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
          {topDomains.map(d => {
            const h = Math.floor(d.totalSeconds / 3600)
            const m = Math.floor((d.totalSeconds % 3600) / 60)
            const label = h > 0 ? `${h}h ${m}m` : `${m}m`
            const barPct = Math.round((d.totalSeconds / maxDomainSec) * 100)
            return (
              <div key={d.domain} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'rgba(255,255,255,0.65)', fontWeight: 500 }}>{d.domain}</span>
                  <span style={{ color: 'rgba(255,255,255,0.35)' }}>{label}</span>
                </div>
                <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    width: `${barPct}%`, height: '100%',
                    background: theme.accent,
                    borderRadius: 2,
                    transition: 'width 1.1s cubic-bezier(0.16,1,0.3,1)',
                  }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </SlideLeft>
  )
}

// ─── Category mix slide ───────────────────────────────────────────────────────

const CAT_DISPLAY_LABELS: Partial<Record<AppCategory, string>> = {
  development:   'Development',
  design:        'Design',
  communication: 'Communication',
  research:      'Research',
  writing:       'Writing',
  aiTools:       'AI tools',
  productivity:  'Productivity',
  meetings:      'Meetings',
  email:         'Email',
  browsing:      'Browsing',
  entertainment: 'Entertainment',
  social:        'Social',
  system:        'System',
  uncategorized: 'Uncategorized',
}

function SlideCategoryMix({ d }: { d: WrappedData }) {
  const items = d.categoryBreakdown.slice(0, 5)
  const maxSec = items[0]?.seconds ?? 1

  return (
    <SlideLeft>
      <p style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.35)', margin: '0 0 16px', textTransform: 'uppercase' }}>
        Where time went
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
        {items.map((item) => {
          const h = Math.floor(item.seconds / 3600)
          const m = Math.floor((item.seconds % 3600) / 60)
          const dur = h > 0 ? `${h}h ${m}m` : `${m}m`
          const barPct = Math.round((item.seconds / maxSec) * 100)
          const accent = CAT_THEME[item.category]?.accent ?? DEFAULT_THEME.accent
          return (
            <div key={item.category} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                <span style={{ color: 'rgba(255,255,255,0.75)', fontWeight: 500 }}>
                  {CAT_DISPLAY_LABELS[item.category] ?? item.category}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                  {dur}
                  <span style={{ color: 'rgba(255,255,255,0.25)', marginLeft: 6 }}>{item.pct}%</span>
                </span>
              </div>
              <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  width: `${barPct}%`, height: '100%',
                  background: accent,
                  borderRadius: 2,
                  transition: 'width 1.1s cubic-bezier(0.16,1,0.3,1)',
                }} />
              </div>
            </div>
          )
        })}
      </div>
    </SlideLeft>
  )
}

// ─── Week-wrap slides ─────────────────────────────────────────────────────────

interface WeekDay {
  dateStr: string
  dayLabel: string
  totalSeconds: number
  dominantCategory: AppCategory
  longestBlockSec: number
}

interface WeekSummary {
  thisWeek: WeekDay[]
  lastWeek: WeekDay[]
}

function useWeekData(enabled: boolean, anchorDate: string): WeekSummary | null {
  const [summary, setSummary] = useState<WeekSummary | null>(null)

  useEffect(() => {
    if (!enabled) return
    const [y, m, d] = anchorDate.split('-').map(Number)
    const anchorMs = new Date(y, m - 1, d).getTime()
    const dates = Array.from({ length: 14 }, (_, i) =>
      dateStringFromMs(anchorMs - (13 - i) * 86_400_000)
    )

    Promise.all(dates.map(date => ipc.db.getTimelineDay(date).catch(() => null)))
      .then(payloads => {
        const process = (p: DayTimelinePayload | null, dateStr: string): WeekDay => {
          const [py, pm, pd] = dateStr.split('-').map(Number)
          const dayLabel = new Date(py, pm - 1, pd).toLocaleDateString('en-US', { weekday: 'short' })
          if (!p || p.totalSeconds === 0) {
            return { dateStr, dayLabel, totalSeconds: 0, dominantCategory: 'development', longestBlockSec: 0 }
          }
          const longestBlockSec = p.blocks.reduce(
            (mx, b) => Math.max(mx, blockActiveSeconds(b)), 0
          )
          return {
            dateStr, dayLabel,
            totalSeconds: p.totalSeconds,
            dominantCategory: deriveData(p).dominantCategory,
            longestBlockSec,
          }
        }
        const all = payloads.map((p, i) => process(p, dates[i]))
        setSummary({ thisWeek: all.slice(7), lastWeek: all.slice(0, 7) })
      })
      .catch(() => {})
  }, [enabled, anchorDate])

  return summary
}

function SlideWeekChart({ week, theme, aiLine = null }: { week: WeekDay[]; theme: SlideTheme; aiLine?: string | null }) {
  const maxSec = Math.max(...week.map(d => d.totalSeconds), 1)

  return (
    <SlideLeft>
      <h1 style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.025em', color: '#fff', margin: '0 0 8px' }}>
        Your week<br />at a glance.
      </h1>
      {aiLine && (
        <p style={{ fontSize: 17, fontWeight: 400, color: 'rgba(255,255,255,0.5)', margin: '4px 0 0', lineHeight: 1.45, maxWidth: '36ch' }}>
          {aiLine}
        </p>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 36, height: 120 }}>
        {week.map((day, i) => {
          const rel   = day.totalSeconds / maxSec
          const barH  = Math.max(4, Math.round(rel * 104))
          const color = CAT_THEME[day.dominantCategory]?.accent ?? DEFAULT_THEME.accent
          const isToday = i === week.length - 1
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1 }}>
              <div style={{
                width: '100%', height: barH, borderRadius: 4,
                background: color,
                opacity: isToday ? 1 : 0.45,
                boxShadow: isToday ? `0 0 14px ${CAT_THEME[day.dominantCategory]?.glow ?? theme.glow}` : 'none',
                transition: `height 0.9s ${i * 0.06}s cubic-bezier(0.16,1,0.3,1)`,
              }} />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.04em', fontWeight: isToday ? 700 : 400 }}>
                {day.dayLabel}
              </span>
            </div>
          )
        })}
      </div>
    </SlideLeft>
  )
}

function SlidePersonalRecord({ week, aiLine = null }: { week: WeekDay[]; aiLine?: string | null }) {
  const best = week.reduce((b, d) => d.longestBlockSec > b.longestBlockSec ? d : b, week[0])
  const h    = Math.floor(best.longestBlockSec / 3600)
  const m    = Math.floor((best.longestBlockSec % 3600) / 60)
  const durStr = h > 0 ? `${h}h ${m}m` : `${m}m`
  const today  = week[week.length - 1]
  const isTodayBest = best.dateStr === today.dateStr

  return (
    <SlideLeft>
      <h1 style={{ fontSize: 66, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.025em', color: '#fff', margin: 0 }}>
        This week's<br />longest stretch.
      </h1>
      <p style={{ fontSize: 56, fontWeight: 900, letterSpacing: '-0.03em', color: '#adc6ff', margin: '20px 0 0' }}>
        {durStr}
      </p>
      <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.45)', marginTop: 12 }}>
        {aiLine ?? (isTodayBest ? 'That was today.' : `That was ${best.dayLabel}.`)}
      </p>
    </SlideLeft>
  )
}

function SlideWeekComparison({ thisWeek, lastWeek, theme, aiLine = null }: { thisWeek: WeekDay[]; lastWeek: WeekDay[]; theme: SlideTheme; aiLine?: string | null }) {
  const thisTotal = thisWeek.reduce((s, d) => s + d.totalSeconds, 0)
  const lastTotal = lastWeek.reduce((s, d) => s + d.totalSeconds, 0)
  const maxTotal  = Math.max(thisTotal, lastTotal, 1)

  const thisH     = Math.floor(thisTotal / 3600)
  const thisM     = Math.floor((thisTotal % 3600) / 60)
  const lastH     = Math.floor(lastTotal / 3600)
  const lastM     = Math.floor((lastTotal % 3600) / 60)

  const diffPct   = lastTotal > 0 ? Math.round(((thisTotal - lastTotal) / lastTotal) * 100) : 0
  const moreLess  = diffPct >= 0 ? 'more' : 'less'
  const absPct    = Math.abs(diffPct)

  const thisBarPct = useAnimatedFill(Math.round((thisTotal / maxTotal) * 100))
  const lastBarPct = useAnimatedFill(Math.round((lastTotal / maxTotal) * 100), 160)

  return (
    <SlideLeft>
      <h1 style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.025em', color: '#fff', margin: 0 }}>
        This week<br />vs last.
      </h1>

      <div style={{ width: '100%', marginTop: 36, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {[
          { label: 'This week', pct: thisBarPct, total: `${thisH}h ${thisM}m`, accent: theme.accent },
          { label: 'Last week', pct: lastBarPct, total: `${lastH}h ${lastM}m`, accent: 'rgba(255,255,255,0.25)' },
        ].map(row => (
          <div key={row.label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'rgba(255,255,255,0.45)' }}>
              <span>{row.label}</span>
              <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>{row.total}</span>
            </div>
            <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.07)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                width: `${row.pct}%`, height: '100%',
                background: row.accent, borderRadius: 3,
                transition: 'width 1.2s cubic-bezier(0.16,1,0.3,1)',
              }} />
            </div>
          </div>
        ))}
      </div>

      {lastTotal > 0 && (
        <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)', marginTop: 20 }}>
          {aiLine ?? (absPct === 0 ? 'About the same as last week.' : `${absPct}% ${moreLess} than last week.`)}
        </p>
      )}
    </SlideLeft>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DayWrapped({
  data,
  threadId,
  artifactId,
  onClose,
  onOpenReport,
  userName = null,
}: {
  data: DayTimelinePayload
  threadId: number | null
  artifactId: number | null
  onClose: () => void
  onOpenReport: () => void
  userName?: string | null
}) {
  const d = useMemo(() => deriveData(data), [data])
  const isMorning = useMemo(() => isPastLocalDate(data.date), [data.date])
  const hasReport = threadId != null && artifactId != null
  const showMorningNudge = Boolean(d.peakBlock && d.peakBlock.durationSeconds > 45 * 60)
  const morningVideoUrl = useMemo(() => MORNING_VIDEO_URLS[dateVariant(data.date, MORNING_VIDEO_URLS.length)], [data.date])
  // Wrapped opens instantly with deterministic copy; the AI-enriched narrative
  // loads asynchronously and overlays the relevant slides once validated.
  const [narrative, setNarrative] = useState<AIWrappedNarrative | null>(null)
  const aiTeaser = narrative?.lead ?? null
  const aiNudge = narrative?.nudge ?? null
  const aiSlides = narrative?.slides ?? null
  const aiPeakInsight = narrative?.peakInsight ?? null

  useEffect(() => {
    let cancelled = false
    setNarrative(null)

    void ipc.ai.getWrappedNarrative(data.date)
      .then((result) => {
        if (cancelled) return
        setNarrative(result ?? null)
      })
      .catch(() => {
        if (!cancelled) setNarrative(null)
      })

    return () => { cancelled = true }
  }, [data.date])

  const isExtended = useMemo(() => {
    if (isMorning) return false
    const [y, m, day] = data.date.split('-').map(Number)
    const dataDate    = new Date(y, m - 1, day)
    const isFriday    = dataDate.getDay() === 5
    const lastOfMonth = new Date(y, m, 0).getDate() === day
    return isFriday || lastOfMonth
  }, [data.date, isMorning])

  const weekSummary = useWeekData(!isMorning && isExtended, data.date)
  const distractionCost = useDistractionCost()

  // Fetch AI period narrative for the week slides when week data is available
  const [periodNarrative, setPeriodNarrative] = useState<WrappedPeriodNarrative | null>(null)
  useEffect(() => {
    if (!weekSummary) { setPeriodNarrative(null); return }
    let cancelled = false

    const thisWeek = weekSummary.thisWeek
    const lastWeek = weekSummary.lastWeek
    const totalSeconds = thisWeek.reduce((s, d) => s + d.totalSeconds, 0)
    const previousPeriodSeconds = lastWeek.reduce((s, d) => s + d.totalSeconds, 0)
    const daysWithActivity = thisWeek.filter(d => d.totalSeconds > 0).length

    // Derive dominant category from the week
    const catTotals = new Map<AppCategory | 'unknown', number>()
    for (const day of thisWeek) {
      if (day.totalSeconds > 0) {
        catTotals.set(day.dominantCategory, (catTotals.get(day.dominantCategory) ?? 0) + day.totalSeconds)
      }
    }
    let dominantCategory: AppCategory | 'unknown' = 'unknown'
    let dominantSeconds = 0
    for (const [cat, sec] of catTotals) {
      if (sec > dominantSeconds) { dominantCategory = cat; dominantSeconds = sec }
    }
    const dominantCategoryPct = totalSeconds > 0 ? Math.round((dominantSeconds / totalSeconds) * 100) : 0

    // Busiest day
    const busiestDay = thisWeek.reduce<typeof thisWeek[0] | null>((best, d) =>
      d.totalSeconds > (best?.totalSeconds ?? 0) ? d : best, null)

    // Longest block
    const longestBlockDay = thisWeek.reduce<typeof thisWeek[0] | null>((best, d) =>
      d.longestBlockSec > (best?.longestBlockSec ?? 0) ? d : best, null)

    const facts: WrappedPeriodFacts = {
      period: 'week',
      anchorDate: data.date,
      totalSeconds,
      previousPeriodSeconds,
      daysWithActivity,
      dominantCategory,
      dominantCategoryPct,
      busiestDay: busiestDay && busiestDay.totalSeconds > 0 ? {
        dateStr: busiestDay.dateStr,
        dayLabel: busiestDay.dayLabel,
        totalSeconds: busiestDay.totalSeconds,
        dominantCategory: busiestDay.dominantCategory,
      } : null,
      longestBlock: longestBlockDay && longestBlockDay.longestBlockSec > 0 ? {
        dateStr: longestBlockDay.dateStr,
        dayLabel: longestBlockDay.dayLabel,
        durationSeconds: longestBlockDay.longestBlockSec,
        dominantCategory: longestBlockDay.dominantCategory,
      } : null,
      buckets: thisWeek.map(d => ({ label: d.dayLabel, totalSeconds: d.totalSeconds, dominantCategory: d.dominantCategory })),
    }

    void ipc.ai.getWrappedPeriodNarrative(facts)
      .then((result) => { if (!cancelled) setPeriodNarrative(result ?? null) })
      .catch(() => { if (!cancelled) setPeriodNarrative(null) })

    return () => { cancelled = true }
  }, [weekSummary, data.date])
  const hasDistractionData = !isMorning && distractionCost !== null && distractionCost.totalDistractionSeconds > 0

  const distractionSlides = hasDistractionData ? 3 : 0
  const weekSlides = !isMorning && isExtended && weekSummary ? 3 : 0

  // Quality gates: empty/tooEarly get a short slide set; partial gets 4 slides
  // Full quality: 8 slides (Scale, Focus, Peak, TopApp, CategoryMix, Switching, Identity, CTA)
  const SLIDE_COUNT = isMorning
    ? (showMorningNudge ? 4 : 3)
    : d.quality === 'empty' ? 1
    : d.quality === 'tooEarly' ? 1
    : d.quality === 'partial' ? 4
    : 8 + distractionSlides + weekSlides

  const [slideIndex, setSlideIndex] = useState(0)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')

  const advance = useCallback(() => {
    setDirection('forward')
    setSlideIndex(i => Math.min(i + 1, SLIDE_COUNT - 1))
  }, [SLIDE_COUNT])

  const goBack = useCallback(() => {
    setDirection('back')
    setSlideIndex(i => Math.max(i - 1, 0))
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape')     onClose()
      if (e.key === 'ArrowRight') advance()
      if (e.key === 'ArrowLeft')  goBack()
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

  const baseThemes = useMemo<SlideTheme[]>(() => {
    if (isMorning) {
      return showMorningNudge
        ? [MORNING_THEMES[0], MORNING_THEMES[1], MORNING_THEMES[2], MORNING_THEMES[3]]
        : [MORNING_THEMES[0], MORNING_THEMES[1], MORNING_THEMES[3]]
    }
    if (d.quality === 'empty' || d.quality === 'tooEarly') {
      return [DEFAULT_THEME]
    }
    if (d.quality === 'partial') {
      return [
        DEFAULT_THEME,
        FOCUS_THEME,
        d.topApp ? catTheme(d.topApp.category) : DEFAULT_THEME,
        DEFAULT_THEME,
      ]
    }
    const coreSlideThemes: SlideTheme[] = [
      DEFAULT_THEME,                                                              // 0: Scale
      FOCUS_THEME,                                                                // 1: Focus
      d.peakBlock ? catTheme(d.peakBlock.category)    : DEFAULT_THEME,           // 2: Peak block
      d.topApp    ? catTheme(d.topApp.category)        : DEFAULT_THEME,           // 3: Top app/domains
      DEFAULT_THEME,                                                              // 4: Category mix
      d.switchesPerHour > 12 || d.totalSwitches > 20 ? SCATTERED_THEME : STEADY_THEME, // 5: Context switching
      identityCatTheme(d.dominantCategory),                                      // 6: Identity
    ]
    const distractionThemes: SlideTheme[] = hasDistractionData ? [
      DISTRACTION_COST_THEME,
      distractionCost?.trendDirection === 'improving' ? DISTRACTION_IMPROVING_THEME :
      distractionCost?.trendDirection === 'worsening' ? DISTRACTION_WORSENING_THEME :
      DISTRACTION_FLAT_THEME,
      DISTRACTION_PEAK_THEME,
    ] : []
    const weekThemes: SlideTheme[] = isExtended && weekSummary ? [
      CAT_THEME.productivity ?? DEFAULT_THEME,
      CAT_THEME.meetings     ?? DEFAULT_THEME,
      DEFAULT_THEME,
    ] : []
    // CTA is always the final slide so the close button is the last thing the
    // user sees, not a distraction-cost slide that appears after dismiss.
    return [...coreSlideThemes, ...distractionThemes, ...weekThemes, DEFAULT_THEME]
  }, [d, distractionCost, hasDistractionData, isExtended, isMorning, showMorningNudge, weekSummary])

  const slideThemes = useMemo(
    () => dedupeAdjacentThemes(baseThemes).map((entry) => rotateGradientForDate(entry, data.date)),
    [baseThemes, data.date],
  )

  const theme    = slideThemes[Math.min(slideIndex, slideThemes.length - 1)]
  const animName = direction === 'forward' ? 'wrappedEnterFromRight' : 'wrappedEnterFromLeft'

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: '#000', cursor: 'default',
        animation: 'wrappedOverlayIn 280ms ease forwards',
      }}
      onClick={handleClick}
    >
      <div
        key={slideIndex}
        style={{
          position: 'absolute', inset: 0,
          background: theme.bg,
          animation: `${animName} 380ms cubic-bezier(0.34,1.56,0.64,1) forwards`,
          overflow: 'hidden',
        }}
      >
        {isMorning && slideIndex === 0 && (
          <>
            <video
              key={morningVideoUrl}
              src={morningVideoUrl}
              autoPlay
              muted
              loop
              playsInline
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                filter: 'saturate(1.06) contrast(1.08)',
                opacity: 0.9,
              }}
            />
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(90deg, rgba(5,8,14,0.78) 0%, rgba(8,12,18,0.5) 42%, rgba(8,12,18,0.22) 100%)',
            }} />
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'radial-gradient(circle at 28% 64%, rgba(255,177,89,0.18), transparent 42%)',
              mixBlendMode: 'screen',
            }} />
          </>
        )}
        {isMorning && slideIndex > 0 && (
          <>
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 74% 18%, rgba(255,246,218,0.16), transparent 36%)' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 18% 82%, rgba(90,36,8,0.24), transparent 42%)' }} />
            <div style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.11'/%3E%3C/svg%3E")`,
              opacity: 0.1,
              mixBlendMode: 'overlay',
            }} />
          </>
        )}

        {isMorning ? (
          <>
            {slideIndex === 0 && <SlideMorningGreeting d={d} userName={userName} aiTeaser={aiTeaser} />}
            {slideIndex === 1 && <SlideCategoryIdentity d={d} theme={theme} morning aiLine={aiSlides?.identity ?? null} />}
            {showMorningNudge && slideIndex === 2 && <SlideMorningNudge d={d} aiNudge={aiNudge} />}
            {((showMorningNudge && slideIndex === 3) || (!showMorningNudge && slideIndex === 2)) && (
              <SlideMorningClose hasReport={hasReport} aiTeaser={aiTeaser} onClose={onClose} onOpenReport={onOpenReport} />
            )}
          </>
        ) : d.quality === 'empty' ? (
          // Empty state: nothing tracked
          <SlideEmpty onClose={onClose} />
        ) : d.quality === 'tooEarly' ? (
          // Too early: under 5 minutes tracked
          <SlideTooEarly d={d} theme={theme} onClose={onClose} />
        ) : d.quality === 'partial' ? (
          // Partial state: 5–45 min tracked — show 4 slides with soft copy
          <>
            {slideIndex === 0 && <SlideScale d={d} theme={theme} aiLine={aiSlides?.scale ?? null} />}
            {slideIndex === 1 && <SlideFocus d={d} theme={theme} aiLine={aiSlides?.focus ?? null} />}
            {slideIndex === 2 && <SlideTopApp d={d} theme={theme} aiLine={aiSlides?.topApp ?? null} />}
            {slideIndex === 3 && <SlideCTA d={d} onClose={onClose} onOpenReport={onOpenReport} hasReport={hasReport} aiTeaser={aiTeaser} aiClosing={aiSlides?.closing ?? null} />}
          </>
        ) : (
          // Full state: 45+ min tracked — 8-slide carousel + optional distraction + week
          <>
            {slideIndex === 0 && <SlideScale d={d} theme={theme} aiLine={aiSlides?.scale ?? null} />}
            {slideIndex === 1 && <SlideFocus d={d} theme={theme} aiLine={aiSlides?.focus ?? null} />}
            {slideIndex === 2 && <SlidePeakBlock d={d} theme={theme} aiInsight={aiPeakInsight} />}
            {slideIndex === 3 && <SlideTopApp d={d} theme={theme} aiLine={aiSlides?.topApp ?? null} />}
            {slideIndex === 4 && <SlideCategoryMix d={d} />}
            {slideIndex === 5 && <SlideContextSwitching d={d} theme={theme} aiLine={aiSlides?.switching ?? null} />}
            {slideIndex === 6 && <SlideCategoryIdentity d={d} theme={theme} aiLine={aiSlides?.identity ?? null} />}
            {hasDistractionData && distractionCost && slideIndex === 7 && (
              <SlideDistractionCost cost={distractionCost} theme={theme} />
            )}
            {hasDistractionData && distractionCost && slideIndex === 8 && (
              <SlideDistractionTrend cost={distractionCost} theme={theme} />
            )}
            {hasDistractionData && distractionCost && slideIndex === 9 && (
              <SlideDistractionPeak cost={distractionCost} theme={theme} />
            )}
            {weekSummary && slideIndex === 7 + distractionSlides && (
              <SlideWeekChart week={weekSummary.thisWeek} theme={theme} aiLine={periodNarrative?.slides.chart ?? null} />
            )}
            {weekSummary && slideIndex === 8 + distractionSlides && (
              <SlidePersonalRecord week={weekSummary.thisWeek} aiLine={periodNarrative?.slides.record ?? null} />
            )}
            {weekSummary && slideIndex === 9 + distractionSlides && (
              <SlideWeekComparison thisWeek={weekSummary.thisWeek} lastWeek={weekSummary.lastWeek} theme={theme} aiLine={periodNarrative?.slides.comparison ?? null} />
            )}
            {slideIndex === 7 + distractionSlides + weekSlides && (
              <SlideCTA d={d} onClose={onClose} onOpenReport={onOpenReport} hasReport={hasReport} aiTeaser={aiTeaser} aiClosing={aiSlides?.closing ?? null} />
            )}
          </>
        )}
      </div>

      {/* Progress bar — clears macOS traffic lights */}
      <div style={{
        position: 'absolute', top: 46, left: 16, right: 56,
        display: 'flex', gap: 4, zIndex: 10, pointerEvents: 'none',
      }}>
        {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: i <= slideIndex ? theme.accent : 'rgba(255,255,255,0.16)',
            transition: 'background 300ms ease',
          }} />
        ))}
      </div>

      {/* Close button */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        style={{
          position: 'absolute', top: 38, right: 16, zIndex: 10,
          width: 36, height: 36, borderRadius: '50%',
          background: 'rgba(255,255,255,0.12)',
          border: '1px solid rgba(255,255,255,0.16)',
          color: 'rgba(255,255,255,0.7)',
          fontSize: 18, lineHeight: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>
  )
}
