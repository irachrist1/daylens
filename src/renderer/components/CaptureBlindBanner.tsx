// DEV-229: shown across the app the moment the main-process permission
// watcher reports capture is blind — the Accessibility grant was revoked or
// silently died (a rebuild/update invalidates it). Pairs with the native
// notification for the case where the window isn't visible; this banner is
// the in-app path to the re-grant walkthrough.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CaptureVerificationState } from '@shared/types'
import { ipc } from '../lib/ipc'

export default function CaptureBlindBanner() {
  const navigate = useNavigate()
  const [state, setState] = useState<CaptureVerificationState | null>(null)

  useEffect(() => {
    void ipc.tracking.getCaptureVerification().then((initial) => {
      if (initial) setState(initial)
    }).catch(() => {})
    return ipc.tracking.onCaptureVerificationChanged(setState)
  }, [])

  if (!state || state.status !== 'blind') return null

  return (
    <div
      role="alert"
      style={{
        padding: '10px 18px',
        background: 'linear-gradient(180deg, rgba(251,191,36,0.16), rgba(251,191,36,0.08))',
        borderBottom: '1px solid rgba(251,191,36,0.28)',
        color: 'var(--color-text-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        flexWrap: 'wrap',
        WebkitAppRegion: 'no-drag',
      } as React.CSSProperties}
    >
      <span
        aria-hidden="true"
        style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgb(251,191,36)', boxShadow: '0 0 0 6px rgba(251,191,36,0.12)', flexShrink: 0 }}
      />
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '-0.01em' }}>
        Daylens can’t see window titles
      </span>
      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
        {state.axTrusted
          ? 'The Accessibility grant stopped working — this happens after updates.'
          : 'Accessibility permission is off.'}
      </span>
      <button
        type="button"
        onClick={() => navigate('/settings?section=capture')}
        style={{
          padding: '4px 12px',
          borderRadius: 8,
          border: '1px solid rgba(251,191,36,0.4)',
          background: 'transparent',
          color: 'var(--color-text-primary)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        Fix now
      </button>
    </div>
  )
}
