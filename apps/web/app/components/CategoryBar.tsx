import { CATEGORY_COLORS, CATEGORY_LABELS, formatDuration } from "@/app/lib/format";

interface CategoryTotal {
  category: string;
  totalSeconds: number;
}

export function CategoryBar({ totals }: { totals: CategoryTotal[] }) {
  const total = totals.reduce((sum, t) => sum + t.totalSeconds, 0);
  if (total === 0) return null;

  return (
    <div className="space-y-3">
      {/* Stacked bar */}
      <div className="flex h-3 overflow-hidden rounded-full">
        {totals.map((t) => (
          <div
            key={t.category}
            className="transition-all"
            style={{
              width: `${(t.totalSeconds / total) * 100}%`,
              backgroundColor: CATEGORY_COLORS[t.category] || CATEGORY_COLORS.uncategorized,
            }}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {totals.map((t) => (
          <div key={t.category} className="flex items-center gap-1.5 text-xs">
            <div
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: CATEGORY_COLORS[t.category] || CATEGORY_COLORS.uncategorized,
              }}
            />
            <span className="text-on-surface-variant">
              {CATEGORY_LABELS[t.category] || t.category}
            </span>
            <span className="font-medium text-on-surface">
              {formatDuration(t.totalSeconds)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
