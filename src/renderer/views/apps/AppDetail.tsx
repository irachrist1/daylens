import type { AISurfaceSummary, AppDetailPayload, AppUsageSummary } from '@shared/types'
import { activityCategoryLabel } from '@shared/activityCategories'
import { activityColorForCategory } from '@shared/activityColors'
import ActivityListCard from '../../components/ActivityListCard'
import EntityIcon from '../../components/EntityIcon'
import InlineRevealText from '../../components/InlineRevealText'
import { formatDisplayAppName } from '../../lib/apps'
import { formatDuration, localDateStringFromMs } from '../../lib/format'
import { openArtifact } from '../../lib/openTarget'
import BrowserActivityBreakdown, { type WebsiteActivityTarget } from './BrowserActivityBreakdown'

export type GenerationStatus =
  | { kind: 'ok' }
  | { kind: 'thin' }
  | { kind: 'no-bundle' }
  | { kind: 'error'; message: string }

function appMetricSentence(totalSeconds: number, sessionCount?: number): string {
  const sessions = sessionCount ?? 0
  return `Tracked for ${formatDuration(totalSeconds)}${sessions ? ` across ${sessions} session${sessions === 1 ? '' : 's'}` : ''}.`
}

function formatBlockRange(startTime: number, endTime: number): string {
  const formatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return `${formatter.format(startTime)} – ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(endTime)}`
}

export default function AppDetail({
  summary,
  rangeLabel,
  detail,
  detailError,
  narrative,
  narrativeError,
  generationStatus,
  isGenerating,
  deleteError,
  deletingActivityKey,
  onGenerate,
  onDeleteWebsiteActivity,
}: {
  summary: AppUsageSummary | null
  rangeLabel: string
  detail: AppDetailPayload | null
  detailError: string | null
  narrative: AISurfaceSummary | null
  narrativeError: string | null
  generationStatus: GenerationStatus | null
  isGenerating: boolean
  deleteError: string | null
  deletingActivityKey: string | null
  onGenerate: () => void
  onDeleteWebsiteActivity: (target: WebsiteActivityTarget) => void
}) {
  if (!summary) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 200 }}>
        <span style={{ fontSize: 13, color: 'var(--color-text-tertiary)', opacity: 0.5 }}>Select an app</span>
      </div>
    )
  }

  const filteredAppearances = detail?.blockAppearances ?? []
  const fileArtifacts = detail?.topArtifacts.filter((artifact) => artifact.artifactType !== 'page') ?? []
  const rollups = detail?.blockMemoryRollups ?? []
  const useRollup = rollups.some((row) => row.patternId && row.sessionCount >= 2)

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ borderRadius: 18, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'start', gap: 14 }}>
          <EntityIcon
            appName={summary.appName}
            bundleId={summary.bundleId}
            canonicalAppId={summary.canonicalAppId}
            color={activityColorForCategory(summary.category)}
            size={38}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <InlineRevealText
              text={formatDisplayAppName(summary.appName)}
              style={{ fontSize: 27, fontWeight: 780, letterSpacing: '-0.03em', color: 'var(--color-text-primary)' }}
            />
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
              {activityCategoryLabel(summary.category)} · {rangeLabel}
            </div>
          </div>
          <button
            type="button"
            disabled={isGenerating}
            onClick={onGenerate}
            style={{
              padding: '7px 10px',
              borderRadius: 8,
              border: '1px solid var(--color-border-ghost)',
              background: 'var(--color-surface-low)',
              color: 'var(--color-text-secondary)',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: isGenerating ? 'default' : 'pointer',
              opacity: isGenerating ? 0.6 : 1,
            }}
          >
            {isGenerating ? 'Generating…' : narrative ? 'Refresh' : 'Generate'}
          </button>
        </div>
        <p style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--color-text-secondary)', margin: '14px 0 0' }}>
          {appMetricSentence(summary.totalSeconds, summary.sessionCount)}
          {narrative?.summary ? ` ${narrative.summary}` : ''}
        </p>
        {!narrative && !isGenerating && !generationStatus && (
          <p style={{ fontSize: 11.5, lineHeight: 1.6, color: 'var(--color-text-tertiary)', margin: '8px 0 0' }}>
            The sites and pages below are computed from your activity. Press Generate for a written recap.
          </p>
        )}
        {narrativeError && !isGenerating && (
          <div style={{ fontSize: 11.5, color: '#f87171', marginTop: 10 }}>Could not load the saved narrative: {narrativeError}</div>
        )}
        {deleteError && (
          <div style={{ fontSize: 11.5, color: '#f87171', marginTop: 10 }}>Could not delete activity: {deleteError}</div>
        )}
        {isGenerating && (
          <div aria-live="polite" style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 10 }}>Generating a stronger app narrative…</div>
        )}
        {!isGenerating && generationStatus?.kind === 'thin' && (
          <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 10 }}>Daylens has only thin signal for this app right now — try again after more activity.</div>
        )}
        {!isGenerating && generationStatus?.kind === 'no-bundle' && (
          <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 10 }}>No recent activity for this app in the selected range.</div>
        )}
        {!isGenerating && generationStatus?.kind === 'error' && (
          <div style={{ fontSize: 11.5, color: '#f87171', marginTop: 10 }}>Could not generate narrative: {generationStatus.message}</div>
        )}
        {narrative?.stale && (
          <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 10 }}>Showing the last saved narrative while new activity settles.</div>
        )}
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 14, letterSpacing: '0.02em' }}>
          {formatDuration(summary.totalSeconds)}
          {summary.sessionCount ? ` · ${summary.sessionCount} session${summary.sessionCount === 1 ? '' : 's'}` : ''}
        </div>
      </div>

      {detailError && <div style={{ color: '#f87171', fontSize: 13 }}>Could not load app detail: {detailError}</div>}

      {!detail && !detailError && (
        <div style={{ display: 'grid', gap: 10 }} aria-label="Loading app detail">
          {[80, 64, 72].map((width) => (
            <div key={width} style={{ height: 56, borderRadius: 14, background: 'var(--color-surface)', border: '1px solid var(--color-border-ghost)', opacity: 0.55, width: `${width}%` }} />
          ))}
        </div>
      )}

      {detail && (
        <>
          {useRollup ? (
            <ActivityListCard
              title="What you did there"
              rows={rollups.slice(0, 10).map((row) => ({
                id: row.patternId ?? row.sampleBlockIds[0],
                label: <>
                  {row.patternLabel}
                  {row.sessionCount > 1 && <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}> × {row.sessionCount} sessions</span>}
                </>,
                detail: `${formatDuration(row.totalSeconds)}${row.sessionCount === 1 ? ` · ${formatBlockRange(row.earliestStart, row.latestEnd)}` : ''}`,
                onClick: () => { window.location.hash = `#/timeline?view=day&date=${localDateStringFromMs(row.earliestStart)}` },
              }))}
            />
          ) : (
            <ActivityListCard
              title="What you did there"
              rows={filteredAppearances.slice(0, 10).map((block) => ({
                id: block.blockId,
                label: block.label,
                detail: formatBlockRange(block.startTime, block.endTime),
                onClick: () => { window.location.hash = `#/timeline?view=day&date=${localDateStringFromMs(block.startTime)}` },
              }))}
            />
          )}

          {fileArtifacts.length > 0 && (
            <section style={{ borderRadius: 18, border: '1px solid var(--color-border-ghost)', background: 'var(--color-surface)', padding: '18px 20px' }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 12 }}>Files & documents</div>
              <div style={{ display: 'grid', gap: 12 }}>
                {fileArtifacts.slice(0, 8).map((artifact) => (
                  <button
                    key={artifact.id}
                    type="button"
                    onClick={() => void openArtifact(artifact)}
                    disabled={artifact.openTarget.kind === 'unsupported' || !artifact.openTarget.value}
                    style={{ display: 'flex', alignItems: 'start', gap: 10, width: '100%', padding: 0, border: 'none', background: 'transparent', textAlign: 'left', cursor: artifact.openTarget.kind === 'unsupported' || !artifact.openTarget.value ? 'default' : 'pointer' }}
                  >
                    <EntityIcon
                      artifactType={artifact.artifactType}
                      canonicalAppId={artifact.canonicalAppId}
                      ownerBundleId={artifact.ownerBundleId}
                      ownerAppName={artifact.ownerAppName}
                      ownerAppInstanceId={artifact.ownerAppInstanceId}
                      title={artifact.displayTitle}
                      path={artifact.path}
                      domain={artifact.host}
                      url={artifact.url}
                      size={28}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <InlineRevealText text={artifact.displayTitle} style={{ fontSize: 13.5, fontWeight: 620, color: 'var(--color-text-primary)' }} />
                      <InlineRevealText text={artifact.subtitle || artifact.host || artifact.path || artifact.artifactType} style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{formatDuration(artifact.totalSeconds)}</div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {detail.browserActivity && (
            <BrowserActivityBreakdown
              key={`${detail.canonicalAppId}:${detail.rangeKey}`}
              activity={detail.browserActivity}
              deletingActivityKey={deletingActivityKey}
              onDelete={onDeleteWebsiteActivity}
            />
          )}
        </>
      )}
    </div>
  )
}
