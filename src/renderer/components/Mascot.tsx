import { useId } from 'react'

// Lumen — the Daylens host. A friendly lens-creature: it *sees* your day (that's
// the whole product) but reads as a warm little character, not a surveillance eye
// or an app icon. Pure inline SVG + CSS so it themes with the aurora card, animates
// without an asset pipeline, and is reusable in empty states later.
//
// Expressions are the host's moods through onboarding:
//   idle    — resting, gentle bob/blink
//   wave    — hello (greeting)
//   think   — pondering (the "why" story, asking about you)
//   watch   — actively looking (the proof / "first signal" moment)
//   happy   — delight (success, ready)
//   curious — head tilt + raised brow (getting to know you)
//   nod     — a quick approving nod (on a pick)

export type MascotExpression = 'idle' | 'wave' | 'think' | 'watch' | 'happy' | 'curious' | 'nod'

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
  const glowGrad = `lumen-glow-${gid}`

  // Where the eye looks, per mood.
  const irisDX = expression === 'curious' ? 4 : 0
  const irisDY = expression === 'think' ? -5 : expression === 'idle' ? 0 : expression === 'happy' || expression === 'wave' ? 1.5 : 0
  const showSmile = expression === 'happy' || expression === 'wave' || expression === 'nod'
  const showSpark = expression === 'wave' || expression === 'happy' || expression === 'curious'
  const showThink = expression === 'think'
  const showBrow = expression === 'curious'
  const showArm = expression === 'wave' || expression === 'happy'
  const showScan = expression === 'watch'

  return (
    <span
      className={`lumen lumen-${expression}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label="Lumen, the Daylens host"
    >
      <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
        <defs>
          <radialGradient id={glowGrad} cx="50%" cy="46%" r="55%">
            <stop offset="0%" stopColor="#bcd0ff" stopOpacity="0.55" />
            <stop offset="55%" stopColor="#c8a7ef" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#c8a7ef" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={irisGrad} cx="38%" cy="34%" r="78%">
            <stop offset="0%" stopColor="#eaeeff" />
            <stop offset="40%" stopColor="#6f86f0" />
            <stop offset="100%" stopColor="#b58fe6" />
          </radialGradient>
          <linearGradient id={bodyGrad} x1="0" y1="0" x2="0.25" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#eef1fb" />
          </linearGradient>
        </defs>

        {/* ambient glow — the "lumen" */}
        <ellipse className="lumen-glow" cx="60" cy="58" rx="52" ry="50" fill={`url(#${glowGrad})`} />

        <g className="lumen-float">
          {/* little feet, so it reads as a creature standing, not an icon */}
          <g className="lumen-feet">
            <ellipse cx="48" cy="99" rx="7" ry="4.4" fill="#e7ebf8" />
            <ellipse cx="72" cy="99" rx="7" ry="4.4" fill="#e7ebf8" />
          </g>

          {/* waving arm (hello / happy) */}
          {showArm && (
            <g className="lumen-arm" transform="translate(94 50)">
              <rect x="-3.5" y="-3.5" width="20" height="7" rx="3.5" fill={`url(#${bodyGrad})`} />
              <circle cx="17" cy="0" r="6" fill={`url(#${bodyGrad})`} />
            </g>
          )}

          {/* soft squircle body — rounded enough to feel alive, no hard icon border */}
          <path
            className="lumen-body"
            d="M60 16
               C90 16 104 30 104 60
               C104 90 90 104 60 104
               C30 104 16 90 16 60
               C16 30 30 16 60 16 Z"
            fill={`url(#${bodyGrad})`}
          />
          {/* faint top sheen */}
          <ellipse cx="50" cy="38" rx="30" ry="18" fill="#ffffff" opacity="0.5" />

          {/* the lens / eye — the face */}
          <g transform={`translate(${irisDX} ${irisDY})`} className="lumen-iris">
            <circle cx="60" cy="58" r="25" fill={`url(#${irisGrad})`} />
            <circle cx="60" cy="58" r="25" fill="none" stroke="rgba(17,24,39,0.05)" strokeWidth="1.5" />
            <circle cx="60" cy="58" r="10.5" fill="#1e2330" className="lumen-pupil" />
            <circle cx="53.5" cy="51.5" r="4" fill="#ffffff" opacity="0.96" />
            <circle cx="66" cy="63" r="2" fill="#ffffff" opacity="0.6" />
          </g>

          {/* scanning focus ring (watch) */}
          {showScan && (
            <circle className="lumen-scan" cx="60" cy="58" r="30" fill="none" stroke="#7fb6ff" strokeWidth="2" strokeDasharray="6 10" />
          )}

          {/* raised brow (curious) */}
          {showBrow && (
            <path className="lumen-brow" d="M70 34 Q80 30 88 36" fill="none" stroke="rgba(17,24,39,0.32)" strokeWidth="2.6" strokeLinecap="round" />
          )}

          {/* blink lid */}
          <path
            className="lumen-lid"
            d="M60 16 C90 16 104 30 104 60 C104 74 98 84 88 92 L32 92 C22 84 16 74 16 60 C16 30 30 16 60 16 Z"
            fill={`url(#${bodyGrad})`}
          />

          {/* friendly smile */}
          {showSmile && (
            <path className="lumen-smile" d="M48 90 Q60 99 72 90" fill="none" stroke="rgba(17,24,39,0.42)" strokeWidth="2.6" strokeLinecap="round" />
          )}

          {/* thinking dots */}
          {showThink && (
            <g className="lumen-think">
              <circle cx="52" cy="92" r="2.3" fill="rgba(17,24,39,0.32)" style={{ animationDelay: '0s' }} />
              <circle cx="60" cy="92" r="2.3" fill="rgba(17,24,39,0.32)" style={{ animationDelay: '0.18s' }} />
              <circle cx="68" cy="92" r="2.3" fill="rgba(17,24,39,0.32)" style={{ animationDelay: '0.36s' }} />
            </g>
          )}
        </g>

        {/* sparkle accent */}
        {showSpark && (
          <path className="lumen-spark" d="M98 26 l2.6 6 6 2.6 -6 2.6 -2.6 6 -2.6 -6 -6 -2.6 6 -2.6 z" fill="#c8a7ef" />
        )}
      </svg>

      <style>{`
        .lumen { display: inline-grid; place-items: center; line-height: 0; }
        .lumen svg { overflow: visible; }
        .lumen-glow { transform-box: fill-box; transform-origin: center; animation: lumen-glow 4s ease-in-out infinite; }
        .lumen-float { transform-box: fill-box; transform-origin: 60px 104px; animation: lumen-float 3.6s ease-in-out infinite; }
        .lumen-iris { transition: transform 360ms cubic-bezier(.22,1,.36,1); }
        .lumen-pupil { transform-box: fill-box; transform-origin: center; animation: lumen-pulse 3.6s ease-in-out infinite; }
        .lumen-lid {
          transform-box: fill-box; transform-origin: top center;
          animation: lumen-blink 5.4s ease-in-out infinite;
        }
        .lumen-spark { transform-box: fill-box; transform-origin: center; animation: lumen-spark 1.9s ease-in-out infinite; }
        .lumen-think circle { animation: lumen-thinkdot 1.2s ease-in-out infinite; }
        .lumen-smile { animation: lumen-pop 340ms ease-out both; }
        .lumen-brow { animation: lumen-pop 340ms ease-out both; }
        .lumen-arm { transform-box: fill-box; transform-origin: 0px 0px; }
        .lumen-scan { transform-box: fill-box; transform-origin: center; animation: lumen-scan 2.6s linear infinite; }
        .lumen-feet { transform-box: fill-box; transform-origin: center; }

        /* per-mood body motion */
        .lumen-wave .lumen-float { animation: lumen-wavebob 1.7s ease-in-out infinite; }
        .lumen-wave .lumen-arm { animation: lumen-wave 1.1s ease-in-out infinite; }
        .lumen-happy .lumen-float { animation: lumen-bounce 1.8s ease-in-out infinite; }
        .lumen-happy .lumen-arm { animation: lumen-wave 1.4s ease-in-out infinite; }
        .lumen-curious .lumen-float { animation: lumen-tilt 4s ease-in-out infinite; }
        .lumen-think .lumen-float { animation: lumen-tilt 5s ease-in-out infinite; }
        .lumen-nod .lumen-float { animation: lumen-nod 1.1s ease-in-out infinite; }
        .lumen-watch .lumen-iris { animation: lumen-look 2.6s ease-in-out infinite; }

        @keyframes lumen-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
        @keyframes lumen-glow { 0%,100% { transform: scale(0.96); opacity: 0.85 } 50% { transform: scale(1.04); opacity: 1 } }
        @keyframes lumen-wavebob { 0%,100% { transform: translateY(0) rotate(-1.5deg) } 50% { transform: translateY(-3px) rotate(1.5deg) } }
        @keyframes lumen-bounce { 0%,100% { transform: translateY(0) } 30% { transform: translateY(-5px) } 60% { transform: translateY(0) } }
        @keyframes lumen-tilt { 0%,100% { transform: rotate(-4deg) } 50% { transform: rotate(4deg) } }
        @keyframes lumen-nod { 0%,100% { transform: translateY(0) } 40% { transform: translateY(3px) } 70% { transform: translateY(0) } }
        @keyframes lumen-wave { 0%,100% { transform: rotate(-6deg) } 50% { transform: rotate(26deg) } }
        @keyframes lumen-look { 0%,100% { transform: translateX(-5px) } 50% { transform: translateX(5px) } }
        @keyframes lumen-blink { 0%,92%,100% { transform: scaleY(0) } 95%,97% { transform: scaleY(1.06) } }
        @keyframes lumen-pulse { 0%,100% { transform: scale(1) } 50% { transform: scale(0.9) } }
        @keyframes lumen-spark { 0%,100% { transform: scale(0.6); opacity: 0.35 } 50% { transform: scale(1); opacity: 1 } }
        @keyframes lumen-thinkdot { 0%,100% { opacity: 0.25; transform: translateY(0) } 50% { opacity: 1; transform: translateY(-1.5px) } }
        @keyframes lumen-scan { to { stroke-dashoffset: -64 } }
        @keyframes lumen-pop { from { opacity: 0; transform: translateY(-2px) } to { opacity: 1; transform: translateY(0) } }

        @media (prefers-reduced-motion: reduce) {
          .lumen-glow, .lumen-float, .lumen-pupil, .lumen-lid, .lumen-spark,
          .lumen-think circle, .lumen-arm, .lumen-scan, .lumen-iris {
            animation: none !important;
          }
        }
      `}</style>
    </span>
  )
}
