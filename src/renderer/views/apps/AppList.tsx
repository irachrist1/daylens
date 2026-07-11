import type { AppUsageSummary } from '@shared/types'
import { activityCategoryLabel } from '@shared/activityCategories'
import { activityColorForCategory } from '@shared/activityColors'
import EntityIcon from '../../components/EntityIcon'
import { formatDisplayAppName } from '../../lib/apps'
import { formatDuration } from '../../lib/format'
import { appSummaryId } from './appsViewModel'

interface AppListProps {
  error: string | null
  summaries: AppUsageSummary[]
  primary: AppUsageSummary[]
  fleeting: AppUsageSummary[]
  selectedAppId: string | null
  compact: boolean
  onSelect: (appId: string) => void
}

export default function AppList({
  error,
  summaries,
  primary,
  fleeting,
  selectedAppId,
  compact,
  onSelect,
}: AppListProps) {
  return (
    <div style={{
      borderRight: compact ? 'none' : '1px solid var(--color-border-ghost)',
      overflowY: 'auto',
      padding: '18px 16px 28px',
    }}>
      {error && <div style={{ color: '#f87171', fontSize: 13 }}>Could not load apps: {error}</div>}

      {!error && summaries.length === 0 && (
        <div style={{
          borderRadius: 16,
          border: '1px solid var(--color-border-ghost)',
          background: 'var(--color-surface)',
          padding: '24px 18px',
          textAlign: 'center',
          color: 'var(--color-text-tertiary)',
        }}>
          No app activity in this range yet.
        </div>
      )}

      <div style={{ display: 'grid', gap: 18 }}>
        {primary.map((summary) => {
          const key = appSummaryId(summary)
          const selected = key === selectedAppId
          return (
            <button
              key={key}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(key)}
              style={{
                width: '100%',
                border: selected ? '1px solid var(--color-border-ghost)' : '1px solid transparent',
                background: selected ? 'var(--color-surface-low)' : 'transparent',
                borderRadius: 14,
                padding: '14px 14px',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <EntityIcon
                  appName={summary.appName}
                  bundleId={summary.bundleId}
                  canonicalAppId={summary.canonicalAppId}
                  color={activityColorForCategory(summary.category)}
                  size={30}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--color-text-primary)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatDisplayAppName(summary.appName)}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 3, lineHeight: 1.3 }}>
                    {activityCategoryLabel(summary.category)} · {formatDuration(summary.totalSeconds)}
                    {summary.sessionCount ? ` · ${summary.sessionCount} session${summary.sessionCount === 1 ? '' : 's'}` : ''}
                  </div>
                </div>
              </div>
            </button>
          )
        })}

        {fleeting.length > 0 && (
          <details style={{ marginTop: 4 }}>
            <summary style={{
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: 'var(--color-text-tertiary)',
              padding: '6px 4px',
              listStyle: 'none',
            }}>
              Smaller or fleeting ({fleeting.length})
            </summary>
            <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
              {fleeting.map((summary) => {
                const key = appSummaryId(summary)
                const selected = key === selectedAppId
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelect(key)}
                    style={{
                      width: '100%',
                      border: selected ? '1px solid var(--color-border-ghost)' : '1px solid transparent',
                      background: selected ? 'var(--color-surface-low)' : 'transparent',
                      borderRadius: 12,
                      padding: '8px 12px',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <EntityIcon
                        appName={summary.appName}
                        bundleId={summary.bundleId}
                        canonicalAppId={summary.canonicalAppId}
                        color={activityColorForCategory(summary.category)}
                        size={22}
                      />
                      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                        {formatDisplayAppName(summary.appName)}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                        {formatDuration(summary.totalSeconds)}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
