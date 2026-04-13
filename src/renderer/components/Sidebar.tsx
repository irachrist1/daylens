import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import type { FocusSession, LiveSession } from '@shared/types'
import { formatDisplayAppName } from '../lib/apps'

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconTimeline() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="4" x2="12" y2="4" />
      <line x1="4" y1="8" x2="10" y2="8" />
      <line x1="4" y1="12" x2="13" y2="12" />
      <circle cx="2.5" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle cx="2.5" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="2.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconApps() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="5" height="5" rx="1.5" />
      <rect x="9" y="2" width="5" height="5" rx="1.5" />
      <rect x="2" y="9" width="5" height="5" rx="1.5" />
      <rect x="9" y="9" width="5" height="5" rx="1.5" />
    </svg>
  )
}

function IconAI() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2c-.8 2-3 3-3 5.5a3 3 0 0 0 6 0C11 5 8.8 4 8 2z" />
      <path d="M6.5 13.5h3" />
      <path d="M8 13v2" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
    </svg>
  )
}

function IconFocusSmall({ active }: { active?: boolean }) {
  if (active) {
    // Stop icon when session is active
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="8" cy="8" r="6.5" />
      <circle cx="8" cy="8" r="3" />
    </svg>
  )
}

// ─── Nav item ─────────────────────────────────────────────────────────────────

interface NavDef {
  to: string
  label: string
  icon: React.ReactNode
}

const MAIN_NAV: NavDef[] = [
  { to: '/timeline', label: 'Timeline', icon: <IconTimeline /> },
  { to: '/apps',     label: 'Apps',     icon: <IconApps /> },
  { to: '/insights', label: 'AI',       icon: <IconAI /> },
]

function formatTimer(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function NavItem({ to, label, icon }: NavDef) {
  const [hovered, setHovered] = useState(false)
  return (
    <NavLink
      to={to}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '9px 12px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: isActive ? 600 : 500,
        letterSpacing: '-0.01em',
        textDecoration: 'none',
        transition: 'all 180ms',
        ...(isActive
          ? {
              color: 'var(--color-text-primary)',
              background: 'var(--color-surface-low)',
              border: '1px solid var(--color-border-ghost)',
              opacity: 1,
            }
          : hovered
            ? {
                color: 'var(--color-text-primary)',
                background: 'var(--color-pill-bg)',
                border: '1px solid transparent',
                opacity: 1,
              }
            : {
                color: 'var(--color-text-secondary)',
                border: '1px solid transparent',
                opacity: 0.78,
              }),
      })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </span>
      {label}
    </NavLink>
  )
}

// ─── Focus duration popover ───────────────────────────────────────────────────

const PRESET_CHIPS = [
  { label: '25m', minutes: 25 },
  { label: '50m', minutes: 50 },
  { label: '90m', minutes: 90 },
]

function FocusPopover({
  anchorRef,
  onStart,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  onStart: (minutes: number, label: string) => void
  onClose: () => void
}) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [selectedMinutes, setSelectedMinutes] = useState(50)
  const [customInput, setCustomInput] = useState('')
  const [label, setLabel] = useState('')

  const displayMinutes = customInput ? (parseInt(customInput, 10) || selectedMinutes) : selectedMinutes

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        anchorRef.current && !anchorRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, anchorRef])

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        left: 0,
        width: 200,
        background: 'var(--color-surface-card)',
        border: '1px solid var(--color-border-ghost)',
        borderRadius: 12,
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        padding: '14px 14px 12px',
        zIndex: 200,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', margin: '0 0 10px' }}>
        Focus session
      </p>

      {/* Duration chips */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
        {PRESET_CHIPS.map((chip) => {
          const active = !customInput && selectedMinutes === chip.minutes
          return (
            <button
              key={chip.minutes}
              onClick={() => { setSelectedMinutes(chip.minutes); setCustomInput('') }}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: '1px solid ' + (active ? 'var(--color-border-ghost)' : 'transparent'),
                background: active ? 'var(--color-surface-low)' : 'var(--color-surface-high)',
                color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                transition: 'all 100ms',
              }}
            >
              {chip.label}
            </button>
          )
        })}
        <input
          type="number"
          min={1}
          max={480}
          placeholder="—m"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onFocus={() => setCustomInput(customInput || '')}
          style={{
            flex: 1, padding: '6px 0', borderRadius: 7, fontSize: 12, fontWeight: 600,
            textAlign: 'center', border: '1px solid',
            borderColor: customInput ? 'var(--color-border-ghost)' : 'transparent',
            background: customInput ? 'var(--color-surface-low)' : 'var(--color-surface-high)',
            color: 'var(--color-text-secondary)',
            outline: 'none', fontFamily: 'inherit',
          }}
        />
      </div>

      {/* Label input */}
      <input
        type="text"
        placeholder="What are you working on?"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onStart(displayMinutes, label) }}
        style={{
          width: '100%', boxSizing: 'border-box',
          padding: '7px 10px', borderRadius: 7, fontSize: 12,
          border: '1px solid var(--color-border-ghost)',
          background: 'var(--color-surface-high)',
          color: 'var(--color-text-primary)',
          outline: 'none', fontFamily: 'inherit', marginBottom: 10,
        }}
      />

      <button
        onClick={() => onStart(displayMinutes, label)}
        style={{
          width: '100%', height: 32, borderRadius: 7, border: 'none', cursor: 'pointer',
          background: 'var(--gradient-primary)',
          color: 'var(--color-primary-contrast)',
          fontSize: 12, fontWeight: 700,
        }}
      >
        Start {displayMinutes}m
      </button>
    </div>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const [activeSession, setActiveSession] = useState<FocusSession | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [live, setLive] = useState<LiveSession | null>(null)
  const [focusPopoverOpen, setFocusPopoverOpen] = useState(false)
  const focusBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      try {
        const [session, liveSession] = await Promise.all([
          window.daylens.focus.getActive(),
          window.daylens.tracking.getLiveSession(),
        ])
        if (!cancelled) {
          setActiveSession((session as FocusSession | null) ?? null)
          setLive((liveSession as LiveSession | null) ?? null)
        }
      } catch {
        if (!cancelled) { setActiveSession(null); setLive(null) }
      }
    }

    void refresh()
    const poll = setInterval(() => void refresh(), 10_000)
    return () => {
      cancelled = true
      clearInterval(poll)
    }
  }, [])

  useEffect(() => {
    if (!activeSession) { setElapsed(0); return }
    const update = () => setElapsed(Math.max(0, Math.round((Date.now() - activeSession.startTime) / 1000)))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [activeSession])

  const startSession = async (targetMinutes: number, label: string) => {
    setFocusPopoverOpen(false)
    await window.daylens.focus.start({ targetMinutes, label: label || null, plannedApps: [] })
    const session = await window.daylens.focus.getActive()
    setActiveSession((session as FocusSession | null) ?? null)
  }

  const stopSession = async () => {
    if (!activeSession) return
    await window.daylens.focus.stop(activeSession.id)
    setActiveSession(null)
    setElapsed(0)
  }

  const targetSeconds = (activeSession?.targetMinutes ?? 0) * 60
  const remainingSeconds = targetSeconds > 0 ? Math.max(0, targetSeconds - elapsed) : 0
  const progressText = activeSession
    ? targetSeconds > 0
      ? remainingSeconds > 0
        ? `${formatTimer(remainingSeconds)} left`
        : `${formatTimer(elapsed - targetSeconds)} overtime`
      : `${formatTimer(elapsed)} elapsed`
    : null

  // Category color for live session dot
  const LIVE_CAT_COLORS: Record<string, string> = {
    development: '#6a91ff', communication: '#ff7a59', research: '#7e63ff',
    writing: '#c084fc', aiTools: '#d86cff', design: '#ff6bb0', browsing: '#f97316',
    meetings: '#14b8a6', entertainment: '#f59e0b', email: '#38bdf8',
    productivity: '#4f46e5', social: '#fb7185', system: '#94a3b8', uncategorized: '#94a3b8',
  }
  const liveColor = live ? (LIVE_CAT_COLORS[live.category] ?? '#94a3b8') : '#94a3b8'

  return (
    <aside
      style={{
        width: 190,
        flexShrink: 0,
        background: 'var(--color-sidebar-bg)',
        borderRight: '1px solid var(--color-sidebar-border)',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '22px 14px',
        boxSizing: 'border-box',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Wordmark */}
      <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '-0.03em', paddingLeft: 2 }}>
        Daylens
      </div>

      {/* Primary nav */}
      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, marginTop: 26 }}>
        {MAIN_NAV.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      {/* Bottom area: Settings + slim focus strip */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <NavItem to="/settings" label="Settings" icon={<IconSettings />} />

        {/* Slim live-tracking status strip */}
        <div style={{
          borderRadius: 10,
          padding: '10px 12px',
          background: 'var(--color-surface-container)',
          border: '1px solid var(--color-border-ghost)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          position: 'relative',
        }}>
          {/* Tracking status row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minWidth: 0 }}>
            {/* Live app + optional countdown */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: live ? liveColor : 'var(--color-text-tertiary)',
                opacity: live ? 1 : 0.4,
              }} />
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: live ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                flex: 1, minWidth: 0,
              }}>
                {live ? formatDisplayAppName(live.appName) : 'Not tracking'}
              </span>
            </div>

            {/* Focus icon button — toggles popover or stops active session */}
            <button
              ref={focusBtnRef}
              onClick={() => {
                if (activeSession) {
                  void stopSession()
                } else {
                  setFocusPopoverOpen((o) => !o)
                }
              }}
              title={activeSession ? 'Stop focus session' : 'Start focus session'}
              style={{
                width: 24, height: 24, borderRadius: 6, border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                background: activeSession ? 'rgba(248,113,113,0.12)' : 'transparent',
                color: activeSession ? '#f87171' : 'var(--color-text-tertiary)',
                transition: 'all 150ms',
              }}
              onMouseEnter={(e) => {
                if (!activeSession) (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-surface-high)'
              }}
              onMouseLeave={(e) => {
                if (!activeSession) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
              }}
            >
              <IconFocusSmall active={!!activeSession} />
            </button>

            {/* Focus popover */}
            {focusPopoverOpen && (
              <FocusPopover
                anchorRef={focusBtnRef}
                onStart={(mins, lbl) => void startSession(mins, lbl)}
                onClose={() => setFocusPopoverOpen(false)}
              />
            )}
          </div>

          {/* Active session: countdown + label */}
          {activeSession && progressText && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#f87171', fontVariantNumeric: 'tabular-nums' }}>
                {progressText}
              </span>
              {activeSession.label && (
                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  · {activeSession.label}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
