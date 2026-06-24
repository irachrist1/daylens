import { useId } from 'react'

// Lumen — the Daylens mascot. A friendly camera-lens character: it *sees* your
// day (that's the whole product) but reads as a warm little creature, not a
// surveillance eye. Pure inline SVG + CSS so it themes with the aurora card,
// animates without an asset pipeline, and can be reused in empty states later.

export type MascotExpression = 'idle' | 'wave' | 'think' | 'happy'

export default function Mascot({
  expression = 'idle',
  size = 96,
}: {
  expression?: MascotExpression
  size?: number
}) {
  const gid = useId().replace(/:/g, '')
  const irisGrad = `lumen-iris-${gid}`
  const bodyGrad = `lumen-body-${gid}`
  // Look up when thinking; a touch lower (relaxed) when happy/waving.
  const irisDY = expression === 'think' ? -5 : expression === 'idle' ? 0 : 1.5
  const showSmile = expression === 'happy' || expression === 'wave'
  const showSpark = expression === 'wave' || expression === 'happy'
  const showThink = expression === 'think'

  return (
    <span
      className={`lumen lumen-${expression}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label="Lumen, the Daylens mascot"
    >
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <defs>
          <radialGradient id={irisGrad} cx="38%" cy="34%" r="75%">
            <stop offset="0%" stopColor="#dfe4ff" />
            <stop offset="42%" stopColor="#6f86f0" />
            <stop offset="100%" stopColor="#c8a7ef" />
          </radialGradient>
          <linearGradient id={bodyGrad} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#f1f3fb" />
          </linearGradient>
        </defs>

        <g className="lumen-bob">
          {/* camera-lens body */}
          <rect
            x="14" y="14" width="72" height="72" rx="26"
            fill={`url(#${bodyGrad})`}
            stroke="rgba(17,24,39,0.10)" strokeWidth="1.5"
          />

          {/* the lens / eye */}
          <g transform={`translate(0 ${irisDY})`} className="lumen-iris">
            <circle cx="50" cy="48" r="22" fill={`url(#${irisGrad})`} />
            <circle cx="50" cy="48" r="22" fill="none" stroke="rgba(17,24,39,0.06)" strokeWidth="1.5" />
            <circle cx="50" cy="48" r="9.5" fill="#1f2633" className="lumen-pupil" />
            <circle cx="44.5" cy="42.5" r="3.6" fill="#ffffff" opacity="0.95" />
            <circle cx="55" cy="53" r="1.7" fill="#ffffff" opacity="0.6" />
          </g>

          {/* blink lid */}
          <rect x="26" y="24" width="48" height="48" rx="22" fill={`url(#${bodyGrad})`} className="lumen-lid" />

          {/* friendly smile (happy / wave) */}
          {showSmile && (
            <path d="M40 74 Q50 81 60 74" fill="none" stroke="rgba(17,24,39,0.45)" strokeWidth="2.4" strokeLinecap="round" className="lumen-smile" />
          )}

          {/* thinking dots */}
          {showThink && (
            <g className="lumen-think">
              <circle cx="44" cy="76" r="2.1" fill="rgba(17,24,39,0.35)" style={{ animationDelay: '0s' }} />
              <circle cx="50" cy="76" r="2.1" fill="rgba(17,24,39,0.35)" style={{ animationDelay: '0.18s' }} />
              <circle cx="56" cy="76" r="2.1" fill="rgba(17,24,39,0.35)" style={{ animationDelay: '0.36s' }} />
            </g>
          )}
        </g>

        {/* sparkle accent */}
        {showSpark && (
          <path d="M80 22 l2.2 5 5 2.2 -5 2.2 -2.2 5 -2.2 -5 -5 -2.2 5 -2.2 z" fill="#c8a7ef" className="lumen-spark" />
        )}
      </svg>

      <style>{`
        .lumen { display: inline-grid; place-items: center; line-height: 0; }
        .lumen svg { overflow: visible; }
        .lumen-bob { transform-box: fill-box; transform-origin: center; animation: lumen-bob 3.4s ease-in-out infinite; }
        .lumen-lid {
          transform-box: fill-box; transform-origin: top center;
          animation: lumen-blink 5.2s ease-in-out infinite;
        }
        .lumen-wave .lumen-bob { animation: lumen-wavebob 1.6s ease-in-out infinite; }
        .lumen-iris { transition: transform 320ms cubic-bezier(.22,1,.36,1); }
        .lumen-pupil { transform-box: fill-box; transform-origin: center; animation: lumen-pulse 3.4s ease-in-out infinite; }
        .lumen-spark { transform-box: fill-box; transform-origin: center; animation: lumen-spark 1.8s ease-in-out infinite; }
        .lumen-think circle { animation: lumen-thinkdot 1.2s ease-in-out infinite; }
        .lumen-smile { animation: lumen-smile 320ms ease-out both; }

        @keyframes lumen-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-2.4px) } }
        @keyframes lumen-wavebob { 0%,100% { transform: translateY(0) rotate(-2deg) } 50% { transform: translateY(-3px) rotate(2deg) } }
        @keyframes lumen-blink {
          0%,92%,100% { transform: scaleY(0) }
          95%,97% { transform: scaleY(1.08) }
        }
        @keyframes lumen-pulse { 0%,100% { transform: scale(1) } 50% { transform: scale(0.92) } }
        @keyframes lumen-spark { 0%,100% { transform: scale(0.6); opacity: 0.35 } 50% { transform: scale(1); opacity: 1 } }
        @keyframes lumen-thinkdot { 0%,100% { opacity: 0.25; transform: translateY(0) } 50% { opacity: 1; transform: translateY(-1.5px) } }
        @keyframes lumen-smile { from { opacity: 0; transform: translateY(-2px) } to { opacity: 1; transform: translateY(0) } }

        @media (prefers-reduced-motion: reduce) {
          .lumen-bob, .lumen-lid, .lumen-pupil, .lumen-spark, .lumen-think circle { animation: none !important; }
        }
      `}</style>
    </span>
  )
}
