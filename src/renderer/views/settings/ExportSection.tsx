// Settings → Export your data (DEV-196). One button exports the person's
// complete Daylens history to a folder they choose, with:
//  - a preview of what will be included (per-section record counts) and what
//    is withheld and why, BEFORE anything is written;
//  - an explicit opt-in for high-sensitivity items (spec: high-sensitivity
//    derived evidence requires an explicit export selection);
//  - live progress while the database streams to disk;
//  - automatic verification (checksums + row counts against the manifest),
//    an "Open folder" affordance, and the deletion-contract disclosure —
//    the export leaves the deletion contract, said out loud at export time;
//  - honest failure states naming the incomplete section.
// Everything runs locally: no model, no network, no account needed.
import { useEffect, useRef, useState } from 'react'
import type {
  HistoryExportPlan,
  HistoryExportProgress,
  HistoryExportRunResult,
  HistoryExportVerification,
} from '@shared/types'
import { ipc } from '../../lib/ipc'

const num = (n: number) => n.toLocaleString('en-US')

function SectionRow({ label, rows, tables }: { label: string; rows: number; tables: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5, padding: '5px 0', borderBottom: '1px solid var(--color-border-ghost, rgba(128,128,128,0.12))' }}>
      <span style={{ color: 'var(--color-text-primary)' }}>{label}</span>
      <span style={{ color: 'var(--color-text-tertiary)', fontSize: 11.5 }}>
        {tables} table{tables === 1 ? '' : 's'}
      </span>
      <span style={{ marginLeft: 'auto', color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
        {num(rows)} records
      </span>
    </div>
  )
}

function VerificationBadge({ verification }: { verification: HistoryExportVerification }) {
  if (verification.ok) {
    return (
      <span style={{ fontSize: 11.5, color: 'var(--color-success, #3a9d5d)', fontWeight: 600 }}>
        Verified — {num(verification.rowsChecked)} records across {verification.tablesChecked} tables match the manifest
      </span>
    )
  }
  return (
    <span style={{ fontSize: 11.5, color: 'var(--color-danger, #d33)', fontWeight: 600 }}>
      Verification failed: {verification.issues.slice(0, 3).join('; ')}
      {verification.issues.length > 3 ? ` (+${verification.issues.length - 3} more)` : ''}
    </span>
  )
}

export function ExportSection() {
  const [plan, setPlan] = useState<HistoryExportPlan | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [includeHigh, setIncludeHigh] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<HistoryExportProgress | null>(null)
  const [result, setResult] = useState<HistoryExportRunResult | null>(null)
  const [reverify, setReverify] = useState<{ exportDir: string; verification: HistoryExportVerification } | null>(null)
  const [showOmissions, setShowOmissions] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const next = await ipc.export.plan({ includeHighSensitivity: includeHigh })
        if (mounted.current) { setPlan(next); setPlanError(null) }
      } catch (error) {
        if (mounted.current) setPlanError(error instanceof Error ? error.message : String(error))
      }
    })()
  }, [includeHigh])

  useEffect(() => {
    return ipc.export.onProgress((event) => {
      if (mounted.current) setProgress(event)
    })
  }, [])

  async function startExport() {
    setResult(null)
    setReverify(null)
    const destination = await ipc.export.chooseDestination()
    if (destination.canceled || !destination.dir) return
    setRunning(true)
    setProgress(null)
    try {
      const runResult = await ipc.export.run({
        destinationDir: destination.dir,
        includeHighSensitivity: includeHigh,
      })
      if (mounted.current) setResult(runResult)
    } catch (error) {
      if (mounted.current) {
        setResult({ ok: false, error: error instanceof Error ? error.message : String(error), incompleteSections: [] })
      }
    } finally {
      if (mounted.current) { setRunning(false); setProgress(null) }
    }
  }

  async function verifyExisting() {
    setReverify(null)
    const response = await ipc.export.verify()
    if (!response.canceled && mounted.current) {
      setReverify({ exportDir: response.exportDir, verification: response.verification })
    }
  }

  const buttonStyle: React.CSSProperties = {
    padding: '7px 14px',
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface-low, transparent)',
    color: 'var(--color-text-primary)',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
  }

  const percent = progress && progress.totalRows > 0
    ? Math.min(100, Math.round((progress.rowsDone / progress.totalRows) * 100))
    : 0

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {planError && <div style={{ fontSize: 12.5, color: 'var(--color-danger, #d33)' }}>{planError}</div>}

      {plan && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            What will be included
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            {plan.firstDay
              ? `${num(plan.totalRows)} records across ${plan.totalTables} tables, covering ${plan.firstDay} through ${plan.lastDay}.`
              : `${num(plan.totalRows)} records across ${plan.totalTables} tables.`}
          </div>
          <div>
            {plan.sections.map((section) => (
              <SectionRow key={section.id} label={section.label} rows={section.rows} tables={section.tables.length} />
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: 'var(--color-text-secondary)', cursor: 'pointer', marginTop: 4 }}>
            <input
              type="checkbox"
              checked={includeHigh}
              onChange={(e) => setIncludeHigh(e.target.checked)}
              disabled={running}
              style={{ marginTop: 2 }}
            />
            <span>
              Include high-sensitivity items
              {!includeHigh && plan.highSensitivityRows > 0 && (
                <> — {num(plan.highSensitivityRows)} record{plan.highSensitivityRows === 1 ? ' is' : 's are'} currently withheld</>
              )}
              . These are records Daylens classified as high-sensitivity; they stay out of the export unless you explicitly choose this.
            </span>
          </label>

          <button
            type="button"
            onClick={() => setShowOmissions((v) => !v)}
            style={{ ...buttonStyle, border: 'none', background: 'transparent', padding: 0, justifySelf: 'start', color: 'var(--color-text-tertiary)', fontWeight: 500, fontSize: 12 }}
          >
            {showOmissions ? 'Hide' : 'Show'} what is withheld and why ({plan.omissions.length} categories)
          </button>
          {showOmissions && (
            <div style={{ display: 'grid', gap: 6, fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.55, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--color-border-ghost, rgba(128,128,128,0.15))' }}>
              {plan.omissions.map((omission) => (
                <div key={omission.category + (omission.reason.slice(0, 24))}>
                  <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>{omission.category}</span>
                  {omission.rows != null && <> ({num(omission.rows)} rows)</>}
                  {': '}
                  {omission.reason}
                </div>
              ))}
              <div>Every withheld category is also listed in the export&apos;s manifest.json.</div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="button" style={{ ...buttonStyle, opacity: running || !plan ? 0.6 : 1 }} disabled={running || !plan} onClick={() => void startExport()}>
          {running ? 'Exporting…' : 'Choose folder & export…'}
        </button>
        <button type="button" style={{ ...buttonStyle, fontWeight: 500, opacity: running ? 0.6 : 1 }} disabled={running} onClick={() => void verifyExisting()}>
          Verify a previous export…
        </button>
      </div>

      {running && progress && (
        <div style={{ display: 'grid', gap: 6 }}>
          <div style={{ height: 6, borderRadius: 999, background: 'var(--color-border-ghost, rgba(128,128,128,0.2))', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${percent}%`, background: 'var(--color-primary-glow, #7aa2f7)', transition: 'width 200ms' }} />
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
            {progress.stage === 'verify'
              ? 'Verifying the export against its manifest…'
              : progress.stage === 'summaries'
                ? 'Writing summaries…'
                : `${progress.table ?? ''} — ${num(progress.rowsDone)} of ${num(progress.totalRows)} records (${percent}%)`}
          </div>
        </div>
      )}

      {result && result.ok && (
        <div style={{ display: 'grid', gap: 8, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--color-text-primary)' }}>Export complete</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
            {num(result.totalRows)} records across {result.totalTables} tables written to{' '}
            <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11.5 }}>{result.exportDir}</span>
          </div>
          <VerificationBadge verification={result.verification} />
          <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
            This folder is now yours, outside Daylens: deleting something in Daylens later will not
            reach into it. The manifest inside lists exactly what was included and what was withheld and why.
          </div>
          <div>
            <button type="button" style={buttonStyle} onClick={() => void ipc.shell.openPath(result.exportDir)}>
              Open folder
            </button>
          </div>
        </div>
      )}

      {result && !result.ok && (
        <div style={{ display: 'grid', gap: 6, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--color-danger, #d33)' }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--color-danger, #d33)' }}>Export failed</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>{result.error}</div>
          {result.incompleteSections.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              Incomplete section{result.incompleteSections.length === 1 ? '' : 's'}: {result.incompleteSections.join(', ')}
            </div>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>
            Nothing was left behind — the partial export folder was removed, and your data in Daylens is unchanged.
          </div>
        </div>
      )}

      {reverify && (
        <div style={{ display: 'grid', gap: 6, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11.5 }}>{reverify.exportDir}</span>
          </div>
          <VerificationBadge verification={reverify.verification} />
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
        The export is generated entirely on this machine — no network, no AI model, no account
        needed. It is one folder: a JSONL file per table, CSV and Markdown summaries, a README
        documenting the format, and a manifest with a checksum and record count for every file, so
        the folder is usable (and checkable) without Daylens.
      </div>
    </div>
  )
}
