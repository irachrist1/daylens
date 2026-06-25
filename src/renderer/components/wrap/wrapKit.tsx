import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { AppCategory } from '@shared/types'
import type { WorkKind } from '@shared/workKind'
import { formatHm } from '../../lib/dayWrapScenes'

// ─── Shared Wrapped kit (DEV-114 / DEV-103) ─────────────────────────────────────
// One visual system and story engine for every Wrapped — today, yesterday, week,
// month, year. The day and period stories assemble scenes from these primitives
// and hand them to <WrapStory>. Nothing here knows about day-vs-period; it is
// the look and the motion, shared.

export { formatHm }

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// ─── Per-scene gradient identity ────────────────────────────────────────────────

export interface Theme { bg: string; accent: string; glow: string }

export const THEME = {
  cover:    { bg: 'linear-gradient(160deg,#0a0f20 0%,#161f52 54%,#2a3fa6 100%)', accent: '#b9ccff', glow: 'rgba(77,120,255,0.42)' },
  headline: { bg: 'linear-gradient(160deg,#0b1224 0%,#15235e 52%,#2747b8 100%)', accent: '#bcd0ff', glow: 'rgba(77,120,255,0.5)' },
  did:      { bg: 'linear-gradient(160deg,#08160f 0%,#0f4034 52%,#16876a 100%)', accent: '#74f0cf', glow: 'rgba(40,210,160,0.42)' },
  shape:    { bg: 'linear-gradient(160deg,#150a22 0%,#421049 52%,#7e1f86 100%)', accent: '#f0a6f5', glow: 'rgba(220,80,230,0.4)' },
  standout: { bg: 'linear-gradient(160deg,#1d1305 0%,#5a3408 52%,#c8841a 100%)', accent: '#ffd79a', glow: 'rgba(255,170,70,0.46)' },
  thread:   { bg: 'linear-gradient(160deg,#08121f 0%,#123a52 52%,#1a6f86 100%)', accent: '#8fe0f5', glow: 'rgba(60,180,220,0.42)' },
  finale:   { bg: 'linear-gradient(160deg,#06070d 0%,#10121c 55%,#1c2233 100%)', accent: '#cfe0ff', glow: 'rgba(150,180,230,0.28)' },
  rest:     { bg: 'linear-gradient(160deg,#0d111a 0%,#222e48 55%,#3a4f74 100%)', accent: '#cdd9f0', glow: 'rgba(160,185,230,0.34)' },
} satisfies Record<string, Theme>

const CAT_COLOR: Partial<Record<AppCategory, string>> = {
  development: '#7eb2ff', aiTools: '#7eb2ff', writing: '#9b8cff', design: '#f472b6',
  research: '#b87aff', meetings: '#f59e0b', communication: '#34d9c4', email: '#22d3ee',
  productivity: '#4ade80', browsing: '#fb923c', entertainment: '#ff6b6b', social: '#a78bfa',
}
export function categoryColor(category: AppCategory | 'unknown', kind?: WorkKind): string {
  if (kind === 'leisure') return '#ff6b6b'
  if (kind === 'personal') return '#9aa6c2'
  if (category === 'unknown') return '#8fb0e6'
  return CAT_COLOR[category] ?? '#8fb0e6'
}

// ─── Count-up (shared rAF clock, reduced-motion aware) ──────────────────────────

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
export function useCountUp(target: number, duration = 1100): number {
  const [val, setVal] = useState(prefersReducedMotion() ? target : 0)
  useEffect(() => {
    if (prefersReducedMotion() || target === 0) { setVal(target); return }
    setVal(0)
    const anim: CountUpAnim = { start: performance.now(), duration, target, set: setVal }
    activeCountUps.add(anim)
    if (countUpRaf == null) countUpRaf = requestAnimationFrame(pumpCountUps)
    return () => { activeCountUps.delete(anim) }
  }, [target, duration])
  return val
}

export function HmCountUp({ seconds, style }: { seconds: number; style: CSSProperties }) {
  const minutes = useCountUp(Math.round(seconds / 60))
  return <span style={style}>{formatHm(minutes * 60)}</span>
}

// ─── Layout primitives ──────────────────────────────────────────────────────────

export function Scene({ children }: { children: ReactNode }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      textAlign: 'center', padding: 'min(11vh, 96px) clamp(28px, 7vw, 88px) min(12vh, 104px)',
      pointerEvents: 'none',
    }}>
      <div style={{ width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {children}
      </div>
    </div>
  )
}

export function Kicker({ children, accent }: { children: ReactNode; accent: string }) {
  return (
    <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: accent, margin: '0 0 26px', opacity: 0.92 }}>
      {children}
    </p>
  )
}

export const subtleLine: CSSProperties = {
  fontSize: 'clamp(18px, 2.6vw, 23px)', fontWeight: 400, lineHeight: 1.5,
  color: 'rgba(255,255,255,0.82)', margin: '26px 0 0', maxWidth: '30ch',
}

export function primaryButton(accent: string): CSSProperties {
  return { padding: '13px 26px', borderRadius: 11, background: accent, color: '#06122a', fontSize: 15, fontWeight: 740, border: 'none', cursor: 'pointer', letterSpacing: '-0.01em' }
}
export const ghostButton: CSSProperties = {
  padding: '13px 22px', borderRadius: 11, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.78)',
  fontSize: 15, fontWeight: 560, border: '1px solid rgba(255,255,255,0.16)', cursor: 'pointer',
}

export function MessageScene({ kicker, title, body, theme, children }: { kicker: string; title: string; body?: string; theme: Theme; children?: ReactNode }) {
  return (
    <Scene>
      <Kicker accent={theme.accent}>{kicker}</Kicker>
      <h1 style={{ fontSize: 'clamp(30px, 5vw, 48px)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em', color: '#fff', margin: 0, maxWidth: '20ch' }}>{title}</h1>
      {body && <p style={{ ...subtleLine, maxWidth: '40ch' }}>{body}</p>}
      {children}
    </Scene>
  )
}

// ─── Scene model ────────────────────────────────────────────────────────────────

export interface BuiltScene { theme: Theme; render: (onRestart: () => void) => ReactNode }

// ─── Shareable card (canvas export, no extra deps) ──────────────────────────────
// A 1080×1350 portrait image that exports cleanly to disk and the clipboard.

export interface ShareCardModel {
  eyebrow: string          // "TUE JUN 24" / "JUN 16 – JUN 22"
  headline: string         // "8h 59m"
  caption: string          // "tracked across the day"
  rows: Array<{ name: string; value: string }>
  statLabel?: string       // "Longest stretch"
  statValue?: string       // "2h 14m"
  footer: string           // "wrapped by Daylens"
}

export async function renderShareCard(model: ShareCardModel): Promise<Blob | null> {
  const W = 1080, H = 1350
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#0a0f20')
  bg.addColorStop(0.55, '#161f52')
  bg.addColorStop(1, '#2a3fa6')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  const accent = '#bcd0ff'
  const pad = 110
  let y = 200

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = accent
  ctx.font = '700 30px Inter, system-ui, sans-serif'
  ctx.fillText('DAYLENS', pad, y)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.fillText(model.eyebrow, W - pad, y)
  ctx.textAlign = 'left'

  y += 150
  ctx.fillStyle = '#ffffff'
  ctx.font = '900 150px Inter, system-ui, sans-serif'
  ctx.fillText(model.headline, pad, y)
  y += 56
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.font = '400 34px Inter, system-ui, sans-serif'
  ctx.fillText(model.caption, pad, y)

  y += 120
  for (let i = 0; i < model.rows.length; i++) {
    ctx.fillStyle = accent
    ctx.font = '800 40px Inter, system-ui, sans-serif'
    ctx.fillText(`${i + 1}`, pad, y)
    ctx.fillStyle = '#ffffff'
    ctx.font = '600 42px Inter, system-ui, sans-serif'
    ctx.fillText(truncateToWidth(ctx, model.rows[i].name, W - pad * 2 - 230), pad + 64, y)
    if (model.rows[i].value) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)'
      ctx.font = '500 38px Inter, system-ui, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(model.rows[i].value, W - pad, y)
      ctx.textAlign = 'left'
    }
    y += 92
  }

  if (model.statLabel && model.statValue) {
    y += 30
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(pad, y - 40); ctx.lineTo(W - pad, y - 40); ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.72)'
    ctx.font = '500 38px Inter, system-ui, sans-serif'
    ctx.fillText(model.statLabel, pad, y + 28)
    ctx.fillStyle = '#ffffff'
    ctx.font = '800 44px Inter, system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(model.statValue, W - pad, y + 30)
    ctx.textAlign = 'left'
  }

  ctx.fillStyle = 'rgba(255,255,255,0.45)'
  ctx.font = '500 30px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(model.footer, W / 2, H - 90)
  ctx.textAlign = 'left'

  return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'))
}

/** Save a share card to disk and (best-effort) copy it to the clipboard. */
export async function saveShareCard(model: ShareCardModel, filename: string): Promise<boolean> {
  const blob = await renderShareCard(model)
  if (!blob) return false
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  try {
    if (navigator.clipboard && 'write' in navigator.clipboard) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    }
  } catch { /* clipboard is best-effort */ }
  return true
}

function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1)
  return `${t}…`
}
