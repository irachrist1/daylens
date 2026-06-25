import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { prefersReducedMotion, saveShareCard, THEME, type BuiltScene } from './wrapKit'

// ─── WrapStory — the shared story shell ─────────────────────────────────────────
// Owns everything that is the same for every Wrapped: full-bleed frame, the
// per-scene gradient, the story progress bar that fills on the auto-advance
// timer, tap zones, press-hold / hover / space to pause, arrow-key nav, a
// visible Next affordance, Esc / X to close, and replay from the last scene.
// It knows nothing about the data — the day and period stories build the scenes.

const SCENE_MS = 6200

export default function WrapStory({ scenes, onClose }: { scenes: BuiltScene[]; onClose: () => void }) {
  const reduced = prefersReducedMotion()
  const sceneCount = Math.max(1, scenes.length)
  const [slideIndex, setSlideIndex] = useState(0)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [hovering, setHovering] = useState(false)
  const [holding, setHolding] = useState(false)
  const paused = hovering || holding
  const isLast = slideIndex >= sceneCount - 1

  useEffect(() => { setSlideIndex(0) }, [sceneCount])

  const advance = useCallback(() => { setDirection('forward'); setSlideIndex((i) => Math.min(i + 1, sceneCount - 1)) }, [sceneCount])
  const goBack = useCallback(() => { setDirection('back'); setSlideIndex((i) => Math.max(i - 1, 0)) }, [])
  const restart = useCallback(() => { setDirection('back'); setSlideIndex(0) }, [])

  // Auto-advance with a pausable progress fill (rAF, resumes where it left off).
  const progressElRef = useRef<HTMLDivElement | null>(null)
  const elapsedRef = useRef(0)
  useEffect(() => { elapsedRef.current = 0; if (progressElRef.current) progressElRef.current.style.width = reduced ? '100%' : '0%' }, [slideIndex, reduced])
  useEffect(() => {
    if (reduced) return // calm: no auto-advance, no count-up — page at your pace
    if (isLast) { if (progressElRef.current) progressElRef.current.style.width = '100%'; return }
    if (paused) return
    let raf = 0, startNow = 0, lastNow = 0, cancelled = false
    function frame(now: number) {
      if (cancelled) return
      if (!startNow) { startNow = now; lastNow = now }
      lastNow = now
      const p = Math.min((elapsedRef.current + (now - startNow)) / SCENE_MS, 1)
      if (progressElRef.current) progressElRef.current.style.width = `${p * 100}%`
      if (p >= 1) { elapsedRef.current = SCENE_MS; advance(); return }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelled = true; if (raf) cancelAnimationFrame(raf); if (startNow) elapsedRef.current += (lastNow - startNow) }
  }, [slideIndex, paused, isLast, advance, reduced])

  // Keyboard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') advance()
      else if (e.key === 'ArrowLeft') goBack()
      else if (e.key === ' ') { e.preventDefault(); setHolding((h) => !h) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance, goBack, onClose])

  // Press-and-hold to pause (touch); a quick tap is a tap-zone nav.
  const holdTimer = useRef<number | null>(null)
  const didHold = useRef(false)
  function onPointerDown() {
    didHold.current = false
    holdTimer.current = window.setTimeout(() => { didHold.current = true; setHolding(true) }, 220)
  }
  function endHold() {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null }
    setHolding(false)
  }
  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button')) return
    if (didHold.current) { didHold.current = false; return }
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.clientX - rect.left < rect.width * 0.32) goBack()
    else advance()
  }

  const active = scenes[Math.min(slideIndex, sceneCount - 1)]
  const theme = active?.theme ?? THEME.rest
  const animName = direction === 'forward' ? 'wrappedEnterFromRight' : 'wrappedEnterFromLeft'

  const body: ReactNode = active ? active.render(restart) : null

  // Per-slide save (wrapped.md §8). Shows briefly as "Saved" then resets.
  const [savedIndex, setSavedIndex] = useState<number | null>(null)
  useEffect(() => { setSavedIndex(null) }, [slideIndex])
  const canSaveSlide = Boolean(active?.share)
  const saveSlide = useCallback(() => {
    if (!active?.share) return
    void saveShareCard(active.share, `${active.shareName ?? 'daylens-slide'}.png`).then((ok) => {
      if (ok) setSavedIndex(slideIndex)
    })
  }, [active, slideIndex])

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', cursor: 'default', animation: 'wrappedOverlayIn 280ms ease forwards' }}
      onClick={onClick}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => { setHovering(false); endHold() }}
      onPointerDown={onPointerDown}
      onPointerUp={endHold}
    >
      <div
        key={slideIndex}
        style={{ position: 'absolute', inset: 0, background: theme.bg, animation: reduced ? 'wrappedOverlayIn 200ms ease forwards' : `${animName} 420ms cubic-bezier(0.34,1.4,0.64,1) forwards`, overflow: 'hidden' }}
      >
        <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 75% 60% at 50% 40%, ${theme.glow}, transparent 72%)` }} />
        {body}
      </div>

      {/* Story progress bar */}
      <div style={{ position: 'absolute', top: 18, left: 16, right: 56, display: 'flex', gap: 5, zIndex: 10, pointerEvents: 'none' }}>
        {Array.from({ length: sceneCount }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.18)', overflow: 'hidden' }}>
            <div
              ref={i === slideIndex ? progressElRef : undefined}
              style={{ height: '100%', borderRadius: 2, background: theme.accent, width: i < slideIndex ? '100%' : '0%' }}
            />
          </div>
        ))}
      </div>

      {/* Close */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose() }}
        style={{ position: 'absolute', top: 30, right: 16, zIndex: 10, width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.16)', color: 'rgba(255,255,255,0.7)', fontSize: 18, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        aria-label="Close"
      >×</button>

      {/* Per-slide save (every slide is a watermarked image, not just the finale) */}
      {canSaveSlide && (
        <button
          onClick={(e) => { e.stopPropagation(); saveSlide() }}
          style={{ position: 'absolute', bottom: 26, left: 22, zIndex: 10, padding: '10px 16px', borderRadius: 999, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          aria-label="Save this slide as an image"
        >{savedIndex === slideIndex ? 'Saved ✓' : 'Save slide'}</button>
      )}

      {/* Visible Next affordance (discoverability) */}
      {!isLast && (
        <button
          onClick={(e) => { e.stopPropagation(); advance() }}
          style={{ position: 'absolute', bottom: 26, right: 22, zIndex: 10, padding: '10px 18px', borderRadius: 999, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          aria-label="Next"
        >Next ›</button>
      )}
    </div>
  )
}
