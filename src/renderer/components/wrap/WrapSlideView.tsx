import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { WrapSlideSpec } from '../../lib/wrapDeck'
import { formatHm } from '../../lib/wrapDeck'
import { HmCountUp, Kicker, Scene, subtleLine, type Theme } from './wrapKit'

// One wrap slide, staged: the kicker lands first, the reveal (number / chart /
// text) pops in, then the prose line fades up. Reduced motion: everything is
// instantly visible, no count-up, no stagger.

function reveal(reduced: boolean, delayMs: number, pop = false): CSSProperties {
  if (reduced) return {}
  return { animation: `${pop ? 'wrappedRevealPop' : 'wrappedRevealUp'} 620ms cubic-bezier(0.16,1,0.3,1) both`, animationDelay: `${delayMs}ms` }
}

const bigStat: CSSProperties = {
  fontSize: 'clamp(64px, 15vw, 128px)', fontWeight: 900, lineHeight: 0.95, letterSpacing: '-0.045em',
}

export default function WrapSlideView({ spec, line, question, reflection, theme, reduced }: {
  spec: WrapSlideSpec
  /** The resolved prose line for this slide (AI or deterministic fallback). */
  line: string
  /** Only read on the question slide. */
  question?: string | null
  /** Only read on the reflection slide. */
  reflection?: string | null
  theme: Theme
  reduced: boolean
}) {
  switch (spec.kind) {
    case 'opening':
      return (
        <Scene>
          <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.22em', color: theme.accent, margin: '0 0 20px', opacity: 0.9, textTransform: 'uppercase', ...reveal(reduced, 0) }}>
            {spec.kicker}
          </p>
          <h1 style={{ fontSize: 'clamp(34px, 5.4vw, 54px)', fontWeight: 800, lineHeight: 1.12, letterSpacing: '-0.025em', color: '#fff', margin: 0, maxWidth: '22ch', ...reveal(reduced, 260) }}>
            {line}
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 38, letterSpacing: '0.02em', ...reveal(reduced, 900) }}>tap for the story ›</p>
        </Scene>
      )

    case 'stat':
      return (
        <Scene>
          <div style={reveal(reduced, 0)}><Kicker accent={theme.accent}>{spec.kicker}</Kicker></div>
          <div style={reveal(reduced, 240, true)}>
            {spec.stat?.seconds != null ? (
              <HmCountUp seconds={spec.stat.seconds} style={{ ...bigStat, color: theme.accent }} />
            ) : (
              <span style={{ ...bigStat, color: theme.accent }}>{spec.stat?.value}</span>
            )}
          </div>
          {spec.stat?.sublabel && (
            <p style={{ fontSize: 'clamp(14px, 2vw, 17px)', fontWeight: 650, color: 'rgba(255,255,255,0.66)', margin: '18px 0 0', maxWidth: '36ch', ...reveal(reduced, 620) }}>
              {spec.stat.sublabel}
            </p>
          )}
          <p style={{ ...subtleLine, ...reveal(reduced, 900) }}>{line}</p>
        </Scene>
      )

    case 'bars':
      return (
        <Scene>
          <div style={reveal(reduced, 0)}><Kicker accent={theme.accent}>{spec.kicker}</Kicker></div>
          <div style={{ width: '100%', maxWidth: 540, display: 'flex', flexDirection: 'column', gap: 15 }}>
            {(spec.bars ?? []).map((bar, i) => (
              <BarRow key={`${bar.name}-${i}`} rank={i} name={bar.name} seconds={bar.seconds} detail={bar.detail}
                max={spec.bars?.[0]?.seconds ?? 1} accent={theme.accent} reduced={reduced} />
            ))}
          </div>
          <p style={{ ...subtleLine, fontSize: 'clamp(16px,2.4vw,20px)', marginTop: 28, ...reveal(reduced, 700) }}>{line}</p>
        </Scene>
      )

    case 'shape':
      return (
        <Scene>
          <div style={reveal(reduced, 0)}><Kicker accent={theme.accent}>{spec.kicker}</Kicker></div>
          <ShapeChart buckets={spec.buckets ?? []} accent={theme.accent} glow={theme.glow} reduced={reduced} />
          <p style={{ ...subtleLine, marginTop: 30, ...reveal(reduced, 800) }}>{line}</p>
        </Scene>
      )

    case 'split': {
      const split = spec.split
      if (!split) return null
      return (
        <Scene>
          <div style={reveal(reduced, 0)}><Kicker accent={theme.accent}>{spec.kicker}</Kicker></div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'clamp(24px, 6vw, 60px)', ...reveal(reduced, 240, true) }}>
            <div>
              <div style={{ fontSize: 'clamp(56px, 11vw, 96px)', fontWeight: 900, letterSpacing: '-0.04em', color: theme.accent, lineHeight: 1 }}>{split.aPct}%</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.75)', marginTop: 10 }}>{split.aLabel} · {formatHm(split.aSeconds)}</div>
            </div>
            <div style={{ opacity: 0.75 }}>
              <div style={{ fontSize: 'clamp(40px, 8vw, 68px)', fontWeight: 900, letterSpacing: '-0.04em', color: '#fff', lineHeight: 1 }}>{split.bPct}%</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginTop: 10 }}>{split.bLabel} · {formatHm(split.bSeconds)}</div>
            </div>
          </div>
          <SplitBar aPct={split.aPct} accent={theme.accent} reduced={reduced} />
          <p style={{ ...subtleLine, ...reveal(reduced, 900) }}>{line}</p>
        </Scene>
      )
    }

    case 'compare': {
      const cmp = spec.compare
      if (!cmp) return null
      const max = Math.max(cmp.currentSeconds, cmp.previousSeconds, 1)
      return (
        <Scene>
          <div style={reveal(reduced, 0)}><Kicker accent={theme.accent}>{spec.kicker}</Kicker></div>
          <div style={{ width: '100%', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 18, ...reveal(reduced, 240) }}>
            <BarRow rank={0} name={cmp.currentLabel} seconds={cmp.currentSeconds} max={max} accent={theme.accent} reduced={reduced} />
            <BarRow rank={1} name={cmp.previousLabel} seconds={cmp.previousSeconds} max={max} accent="rgba(255,255,255,0.35)" reduced={reduced} />
          </div>
          <p style={{ ...subtleLine, ...reveal(reduced, 800) }}>{line}</p>
        </Scene>
      )
    }

    case 'text':
      return (
        <Scene>
          <div style={reveal(reduced, 0)}><Kicker accent={theme.accent}>{spec.kicker}</Kicker></div>
          <h1 style={{ fontSize: 'clamp(26px, 4.2vw, 42px)', fontWeight: 750, lineHeight: 1.22, letterSpacing: '-0.02em', color: '#fff', margin: 0, maxWidth: '26ch', ...reveal(reduced, 280) }}>
            {line}
          </h1>
        </Scene>
      )

    case 'question':
      return (
        <Scene>
          <div style={reveal(reduced, 0)}><Kicker accent={theme.accent}>{spec.kicker}</Kicker></div>
          <h1 style={{ fontSize: 'clamp(26px, 4.4vw, 44px)', fontWeight: 780, lineHeight: 1.2, letterSpacing: '-0.02em', color: '#fff', margin: 0, maxWidth: '24ch', ...reveal(reduced, 280) }}>
            {question || spec.fallbackLine}
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 26, ...reveal(reduced, 800) }}>
            answer below, or just keep going ›
          </p>
        </Scene>
      )

    case 'reflection':
      return (
        <Scene>
          <div style={reveal(reduced, 0)}><Kicker accent={theme.accent}>{spec.kicker}</Kicker></div>
          <p style={{
            fontSize: 'clamp(19px, 2.8vw, 25px)', fontWeight: 500, lineHeight: 1.62, color: 'rgba(255,255,255,0.94)',
            margin: 0, maxWidth: '44ch', textAlign: 'left', ...reveal(reduced, 320),
          }}>
            {reflection || spec.fallbackLine}
          </p>
        </Scene>
      )

    default:
      return null
  }
}

// ─── Chart primitives ─────────────────────────────────────────────────────────

function BarRow({ rank, name, seconds, detail, max, accent, reduced }: {
  rank: number; name: string; seconds: number; detail?: string; max: number; accent: string; reduced: boolean
}) {
  const [fill, setFill] = useState(reduced ? 1 : 0)
  useEffect(() => {
    if (reduced) { setFill(1); return }
    const id = setTimeout(() => setFill(1), 160 + rank * 100)
    return () => clearTimeout(id)
  }, [reduced, rank])
  const pct = Math.round((seconds / Math.max(max, 1)) * 100)
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 7, ...reveal(reduced, 120 + rank * 100) }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontSize: 'clamp(16px, 2.3vw, 20px)', fontWeight: 650, color: '#fff', flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'rgba(255,255,255,0.62)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {formatHm(seconds)}{detail ? <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}> · {detail}</span> : null}
        </span>
      </div>
      <div style={{ height: 5, background: 'rgba(255,255,255,0.09)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${fill * pct}%`, height: '100%', background: accent, borderRadius: 3, transition: reduced ? 'none' : 'width 1s cubic-bezier(0.16,1,0.3,1)' }} />
      </div>
    </div>
  )
}

function ShapeChart({ buckets, accent, glow, reduced }: {
  buckets: Array<{ label: string; seconds: number; peak: boolean }>; accent: string; glow: string; reduced: boolean
}) {
  const max = Math.max(...buckets.map((b) => b.seconds), 1)
  const [grown, setGrown] = useState(reduced)
  useEffect(() => {
    if (reduced) { setGrown(true); return }
    const id = setTimeout(() => setGrown(true), 200)
    return () => clearTimeout(id)
  }, [reduced])
  const many = buckets.length > 8
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: many ? 6 : 10, height: 160, width: '100%', maxWidth: 560 }}>
      {buckets.map((b, i) => {
        const h = grown ? Math.max(4, Math.round((b.seconds / max) * 138)) : 4
        return (
          <div key={`${b.label}-${i}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, flex: 1 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.55)', opacity: grown && b.peak ? 1 : 0, transition: 'opacity 400ms 600ms' }}>
              {b.peak ? formatHm(b.seconds) : ''}
            </span>
            <div style={{
              width: '100%', height: h, borderRadius: 6,
              background: accent, opacity: b.peak ? 1 : 0.38,
              boxShadow: b.peak ? `0 0 18px ${glow}` : 'none',
              transition: reduced ? 'none' : `height 0.9s ${i * 0.06}s cubic-bezier(0.16,1,0.3,1)`,
            }} />
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.46)', fontWeight: b.peak ? 700 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
              {many ? b.label.slice(0, 1) : b.label.replace('Week of ', '')}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function SplitBar({ aPct, accent, reduced }: { aPct: number; accent: string; reduced: boolean }) {
  const [grown, setGrown] = useState(reduced)
  useEffect(() => {
    if (reduced) { setGrown(true); return }
    const id = setTimeout(() => setGrown(true), 350)
    return () => clearTimeout(id)
  }, [reduced])
  return (
    <div style={{ width: 'min(440px, 74vw)', height: 10, borderRadius: 5, overflow: 'hidden', background: 'rgba(255,255,255,0.16)', marginTop: 34, display: 'flex' }}>
      <div style={{ width: grown ? `${aPct}%` : '0%', background: accent, transition: reduced ? 'none' : 'width 1.1s cubic-bezier(0.16,1,0.3,1)' }} />
    </div>
  )
}
