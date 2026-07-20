// Settings → Screen context (experiment) — DEV-198.
//
// The opt-in surface for the screen-context experiment on top of the DEV-197
// lifecycle. Everything the spec demands a tester can see and do lives here:
// the explicit consent flow in deliberately plain, scary-clear language; the
// pause switch; the backlog and quarantine with explicit Retry/Delete; the
// per-excluded-app deletion offers; the full wipe; and honest status —
// including the truth that no OS screen sampler ships in this build yet, so
// consent prepares the pipeline rather than starting invisible capture.
import { useCallback, useEffect, useState } from 'react'
import type { ScreenContextBacklogFrame, ScreenContextStatus } from '@shared/types'
import { ipc } from '../../lib/ipc'

const buttonStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: '7px 14px',
  borderRadius: 9,
  border: '1px solid var(--color-border-ghost)',
  background: 'var(--color-surface-low)',
  color: 'var(--color-text-primary)',
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'var(--gradient-primary)',
  color: 'var(--color-primary-contrast)',
  border: 'none',
  fontWeight: 620,
}

const dangerButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  color: '#f87171',
  borderColor: 'rgba(248, 113, 113, 0.4)',
}

const cardStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: '14px 16px',
  borderRadius: 14,
  border: '1px solid var(--color-border-ghost)',
  background: 'var(--color-surface-low)',
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function frameStateLabel(state: string): string {
  switch (state) {
    case 'captured': return 'Waiting for extraction'
    case 'extracting': return 'Extracting'
    case 'indexed': return 'Extracted — deleting the image'
    case 'safe_to_delete': return 'Deleting the image'
    case 'failed':
    case 'quarantined': return 'Extraction failed — quarantined'
    default: return state
  }
}

function ExperimentBadge() {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        padding: '3px 8px',
        borderRadius: 6,
        border: '1px solid rgba(251, 191, 36, 0.45)',
        color: '#fbbf24',
        background: 'rgba(251, 191, 36, 0.08)',
      }}
    >
      Experiment
    </span>
  )
}

// The consent copy. Deliberately scary-clear (screen-context.md §Product
// behavior): it leads with the uncomfortable fact, then what happens to each
// image, what is never captured, and the ways out. No softening.
const CONSENT_POINTS: Array<{ title: string; body: string }> = [
  {
    title: 'Daylens will take pictures of your screen.',
    body: 'While the experiment is on, it captures still snapshots of your active display — at most one automatic frame every 30 seconds, never continuous video, never audio.',
  },
  {
    title: 'Each picture is read once, then destroyed.',
    body: 'A frame is stored encrypted on this machine, useful details are extracted from it (a document title, short text snippets), and the image is deleted the moment those details are safely stored — usually within seconds, always within 24 hours.',
  },
  {
    title: 'Some things are never captured.',
    body: 'Private and incognito windows, password, payment, and security screens, apps and websites you have excluded, and anything on screen while you are sharing it — sampling stops before capture, not after.',
  },
  {
    title: 'Nothing leaves this machine.',
    body: 'During the experiment, screen-derived details are local-only: never synced, never exported, never sent to an AI provider, never included in analytics.',
  },
  {
    title: 'You stay in control.',
    body: 'Pause instantly, inspect every stored frame below, delete any or all of it, and leave the experiment at any time — leaving deletes unprocessed pictures immediately, and normal tracking is unaffected.',
  },
]

export function ScreenContextSection() {
  const [status, setStatus] = useState<ScreenContextStatus | null>(null)
  const [backlog, setBacklog] = useState<{ frames: ScreenContextBacklogFrame[]; totals: { frames: number; bytes: number } } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmingWipe, setConfirmingWipe] = useState(false)
  const [confirmingLeave, setConfirmingLeave] = useState(false)
  const [leaveWipesEverything, setLeaveWipesEverything] = useState(true)

  const reload = useCallback(async () => {
    try {
      const [nextStatus, nextBacklog] = await Promise.all([
        ipc.screenContext.status(),
        ipc.screenContext.listBacklog(),
      ])
      setStatus(nextStatus)
      setBacklog(nextBacklog)
      setError(null)
    } catch {
      setError('Couldn’t load the experiment status. Try again in a moment.')
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  async function run(action: () => Promise<{ ok: boolean; reason?: string | null }>) {
    setBusy(true)
    try {
      const result = await action()
      if (!result.ok && result.reason) setError(result.reason)
      else setError(null)
      await reload()
    } catch {
      setError('That didn’t work. Try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    return <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>{error ?? 'Loading…'}</div>
  }

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <ExperimentBadge />
      <span style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)' }}>
        Testing whether fleeting screen snapshots help Daylens understand work that window titles can’t explain.
        This may never ship — it becomes a feature only if it earns it.
      </span>
    </div>
  )

  if (!status.supportedPlatform || (!status.eligible && !status.enabled)) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        {header}
        <div style={cardStyle}>
          <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
            {status.eligibilityReason ?? 'The experiment is not available right now.'}
          </span>
        </div>
      </div>
    )
  }

  if (!status.enabled) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        {header}
        {error && <div style={{ fontSize: 12.5, color: '#f87171' }}>{error}</div>}
        <div style={{ display: 'grid', gap: 14 }}>
          {CONSENT_POINTS.map((point) => (
            <div key={point.title} style={{ display: 'grid', gap: 3 }}>
              <span style={{ fontSize: 13, fontWeight: 650, color: 'var(--color-text-primary)' }}>{point.title}</span>
              <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>{point.body}</span>
            </div>
          ))}
        </div>
        <div style={cardStyle}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--color-text-primary)', lineHeight: 1.5 }}>
            <input
              type="checkbox"
              checked={understood}
              onChange={(event) => setUnderstood(event.target.checked)}
              style={{ marginTop: 2 }}
            />
            I understand Daylens will capture images of my screen while this experiment is on.
          </label>
          <div>
            <button
              type="button"
              style={{ ...primaryButtonStyle, opacity: understood && !busy ? 1 : 0.5 }}
              disabled={!understood || busy}
              onClick={() => void run(() => ipc.screenContext.enable())}
            >
              Join the experiment
            </button>
          </div>
          <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>
            Joining is separate from every other Daylens permission — normal tracking never turns this on, and this never changes normal tracking.
          </span>
        </div>
      </div>
    )
  }

  const quarantined = backlog?.frames.filter((frame) => frame.state === 'failed' || frame.state === 'quarantined') ?? []

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {header}
      {error && <div style={{ fontSize: 12.5, color: '#f87171' }}>{error}</div>}

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 620, color: 'var(--color-text-primary)' }}>
            {status.paused ? 'Joined · paused' : 'Joined · on'}
          </span>
          {status.consentAt && (
            <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>
              consented {new Date(status.consentAt).toLocaleDateString()}
            </span>
          )}
          <button
            type="button"
            style={{ ...buttonStyle, marginLeft: 'auto' }}
            disabled={busy}
            onClick={() => void run(() => ipc.screenContext.setPaused(!status.paused))}
          >
            {status.paused ? 'Resume sampling' : 'Pause sampling'}
          </button>
        </div>
        {!status.samplerInstalled && (
          <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
            Nothing is being captured yet: this build has no screen sampler installed. Your consent prepares the
            pipeline; when the sampler ships in a later build, a visible indicator will show whenever sampling is
            active, and everything below applies to what it captures.
          </span>
        )}
        {status.backlogCapReached && (
          <span style={{ fontSize: 12.5, color: '#fbbf24' }}>
            The frame backlog reached its cap — sampling is paused until it drains or you delete frames below.
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 13.5, fontWeight: 620, color: 'var(--color-text-primary)' }}>Stored frames</span>
          <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>
            {backlog ? `${backlog.totals.frames} on disk · ${fmtBytes(backlog.totals.bytes)}` : ''}
            {status.evidenceCount > 0 ? ` · ${status.evidenceCount} extracted record${status.evidenceCount === 1 ? '' : 's'} (local-only)` : ''}
          </span>
        </div>
        {!backlog || backlog.frames.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--color-text-tertiary)', lineHeight: 1.55 }}>
            No frames stored — nothing has been captured.
          </div>
        ) : (
          backlog.frames.map((frame) => {
            const isQuarantined = frame.state === 'failed' || frame.state === 'quarantined'
            return (
              <div
                key={frame.id}
                style={{ ...cardStyle, gap: 6, padding: '12px 14px' }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 620, color: 'var(--color-text-primary)' }}>
                    {frame.appName ?? 'Unknown app'}
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>
                    {new Date(frame.capturedAt).toLocaleString()} · {fmtBytes(frame.byteSize)} · {frameStateLabel(frame.state)}
                    {frame.retryCount > 0 ? ` · ${frame.retryCount} retr${frame.retryCount === 1 ? 'y' : 'ies'}` : ''}
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    {isQuarantined && (
                      <button
                        type="button"
                        style={buttonStyle}
                        disabled={busy}
                        onClick={() => void run(() => ipc.screenContext.retryFrame(frame.id))}
                      >
                        Retry
                      </button>
                    )}
                    <button
                      type="button"
                      style={dangerButtonStyle}
                      disabled={busy}
                      onClick={() => void run(async () => ipc.screenContext.deleteFrame(frame.id))}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {isQuarantined && frame.lastError && (
                  <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>
                    Kept encrypted and out of every product surface until you retry or delete it.
                  </span>
                )}
              </div>
            )
          })
        )}
        {quarantined.length > 0 && (
          <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>
            A quarantined frame is never deleted automatically — it is the only copy, and the decision is yours.
          </span>
        )}
      </div>

      {status.exclusionOffers.length > 0 && (
        <div style={{ display: 'grid', gap: 10 }}>
          <span style={{ fontSize: 13.5, fontWeight: 620, color: 'var(--color-text-primary)' }}>
            Excluded apps with screen records
          </span>
          <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
            These apps are excluded from tracking, but screen records from before the exclusion still exist. You can delete them now.
          </span>
          {status.exclusionOffers.map((offer) => (
            <div key={offer.source} style={{ ...cardStyle, gap: 6, padding: '12px 14px' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 12.5, fontWeight: 620, color: 'var(--color-text-primary)' }}>{offer.source}</span>
                <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>
                  {offer.frameCount} frame{offer.frameCount === 1 ? '' : 's'} · {offer.evidenceCount} extracted record{offer.evidenceCount === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  style={{ ...dangerButtonStyle, marginLeft: 'auto' }}
                  disabled={busy}
                  onClick={() => void run(async () => ipc.screenContext.deleteForSource(offer.source))}
                >
                  Delete these records
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        <span style={{ fontSize: 13.5, fontWeight: 620, color: 'var(--color-text-primary)' }}>Leave or wipe</span>
        {confirmingWipe ? (
          <div style={{ ...cardStyle, borderColor: 'rgba(248, 113, 113, 0.4)' }}>
            <span style={{ fontSize: 12.5, color: 'var(--color-text-primary)', lineHeight: 1.55 }}>
              Delete every screen frame and every extracted screen record on this machine? This cannot be undone.
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                style={dangerButtonStyle}
                disabled={busy}
                onClick={() => { setConfirmingWipe(false); void run(async () => ipc.screenContext.wipe()) }}
              >
                Delete everything
              </button>
              <button type="button" style={buttonStyle} onClick={() => setConfirmingWipe(false)}>Cancel</button>
            </div>
          </div>
        ) : confirmingLeave ? (
          <div style={{ ...cardStyle, borderColor: 'rgba(248, 113, 113, 0.4)' }}>
            <span style={{ fontSize: 12.5, color: 'var(--color-text-primary)', lineHeight: 1.55 }}>
              Leave the experiment? Unprocessed pictures are deleted immediately and no more will ever be taken.
              Normal tracking is unaffected.
            </span>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--color-text-primary)' }}>
              <input
                type="checkbox"
                checked={leaveWipesEverything}
                onChange={(event) => setLeaveWipesEverything(event.target.checked)}
              />
              Also delete everything already extracted (recommended)
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                style={dangerButtonStyle}
                disabled={busy}
                onClick={() => {
                  setConfirmingLeave(false)
                  void run(() => ipc.screenContext.revoke({ wipeEverything: leaveWipesEverything }))
                }}
              >
                Leave the experiment
              </button>
              <button type="button" style={buttonStyle} onClick={() => setConfirmingLeave(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={dangerButtonStyle} disabled={busy} onClick={() => setConfirmingLeave(true)}>
              Leave the experiment…
            </button>
            <button type="button" style={dangerButtonStyle} disabled={busy} onClick={() => setConfirmingWipe(true)}>
              Delete all screen data…
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
