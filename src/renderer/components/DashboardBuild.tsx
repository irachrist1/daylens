import { useEffect, useRef, useState } from 'react'

// The hand-off from onboarding into the app: a short, delightful "we're building
// your dashboard" moment. Mock dashboard pieces drop in from the top and stack
// like Tetris, then the whole thing fades to reveal the real app underneath.
// Reduced-motion users get a brief, still hold instead.

export default function DashboardBuild({ name, onDone }: { name?: string; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const reducedMotion = useRef(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    const hold = reducedMotion.current ? 500 : 2300
    const fade = reducedMotion.current ? 200 : 520
    const t1 = window.setTimeout(() => setLeaving(true), hold)
    const t2 = window.setTimeout(() => onDone(), hold + fade)
    return () => { window.clearTimeout(t1); window.clearTimeout(t2) }
  }, [onDone])

  // The pieces that "build" the dashboard, in stack order (drop delay scales with i).
  const pieces = [
    { cls: 'db-topbar', label: '' },
    { cls: 'db-side', label: '' },
    { cls: 'db-row db-row-a', label: 'Writing the proposal' },
    { cls: 'db-row db-row-b', label: 'Team call' },
    { cls: 'db-row db-row-c', label: 'Inbox & Slack' },
    { cls: 'db-card db-card-1', label: '' },
    { cls: 'db-card db-card-2', label: '' },
  ]

  return (
    <div className={`db-overlay${leaving ? ' is-leaving' : ''}${reducedMotion.current ? ' is-still' : ''}`}>
      <div className="db-stage" aria-hidden="true">
        {pieces.map((p, i) => (
          <div key={p.cls} className={`db-piece ${p.cls}`} style={{ animationDelay: `${0.12 + i * 0.16}s` }}>
            {p.label && <span className="db-piece-label">{p.label}</span>}
          </div>
        ))}
      </div>
      <div className="db-caption">
        <div className="db-spark" aria-hidden="true"><span /><span /><span /></div>
        <div className="db-title">Building {name ? `${name}'s` : 'your'} Daylens…</div>
        <div className="db-sub">Stacking your day into something you'll actually recognise.</div>
      </div>

      <style>{`
        .db-overlay {
          position: fixed; inset: 0; z-index: 50;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px;
          background:
            radial-gradient(120% 80% at 12% 0%, rgba(111,134,240,0.16), transparent 52%),
            radial-gradient(120% 80% at 100% 8%, rgba(200,167,239,0.16), transparent 50%),
            #f4f5fb;
          transition: opacity 520ms ease, transform 520ms ease;
        }
        .db-overlay.is-leaving { opacity: 0; transform: scale(1.015); pointer-events: none; }

        .db-stage {
          position: relative;
          width: min(440px, 78vw); height: 260px;
          border-radius: 18px;
          background: #ffffff;
          border: 1px solid rgba(17,24,39,0.07);
          box-shadow: 0 30px 80px rgba(26,33,68,0.18);
          overflow: hidden;
        }
        .db-piece {
          position: absolute; border-radius: 8px;
          animation: dbDrop 560ms cubic-bezier(.2,1.1,.3,1) both;
        }
        .db-piece-label {
          position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
          font-size: 11px; font-weight: 650; color: #2a3da8; white-space: nowrap;
        }
        .db-topbar { top: 0; left: 0; right: 0; height: 38px; border-radius: 0; background: linear-gradient(135deg, rgba(111,134,240,0.18), rgba(200,167,239,0.14)); }
        .db-side { top: 46px; left: 0; bottom: 0; width: 86px; background: #f3f4fa; }
        .db-row { left: 98px; right: 14px; height: 34px; }
        .db-row-a { top: 52px; background: linear-gradient(135deg, rgba(123,143,247,0.30), rgba(90,179,255,0.20)); }
        .db-row-b { top: 92px; background: linear-gradient(135deg, rgba(178,160,255,0.28), rgba(123,143,247,0.18)); }
        .db-row-c { top: 132px; background: rgba(17,24,39,0.05); }
        .db-row-c .db-piece-label { color: #5c6474; }
        .db-card { bottom: 14px; height: 56px; background: #fafbff; border: 1px solid rgba(17,24,39,0.06); }
        .db-card-1 { left: 98px; width: 38%; }
        .db-card-2 { right: 14px; width: 38%; }

        .db-caption { text-align: center; display: grid; gap: 6px; justify-items: center; }
        .db-spark { display: flex; gap: 7px; margin-bottom: 4px; }
        .db-spark span { width: 9px; height: 9px; border-radius: 50%; background: linear-gradient(135deg, #6f86f0, #5ab3ff); animation: dbBreath 1.3s ease-in-out infinite; }
        .db-spark span:nth-child(2) { animation-delay: 0.18s; }
        .db-spark span:nth-child(3) { animation-delay: 0.36s; }
        .db-title { font-size: 19px; font-weight: 760; letter-spacing: -0.02em; color: #1f2633; }
        .db-sub { font-size: 13px; color: #5c6474; max-width: 38ch; }

        @keyframes dbDrop {
          0% { opacity: 0; transform: translateY(-260px); }
          80% { opacity: 1; }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes dbBreath { 0%,100% { transform: scale(0.7); opacity: 0.5; } 50% { transform: scale(1); opacity: 1; } }

        .db-overlay.is-still .db-piece { animation: none; }
        .db-overlay.is-still .db-spark span { animation: none; }
        @media (prefers-reduced-motion: reduce) {
          .db-piece, .db-spark span { animation: none !important; }
        }
      `}</style>
    </div>
  )
}
