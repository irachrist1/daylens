import Link from "next/link";
import type { DaySnapshot, DaySnapshotV2 } from "../../packages/remote-contract";
import { isSnapshotV2 } from "../../packages/remote-contract";
import { TimelineSurface } from "@/app/components/TimelineSurface";

export type SnapshotShape = Record<string, unknown> & {
  schemaVersion?: number;
};

interface SnapshotContentProps {
  snapshot: SnapshotShape;
  date: string;
  showAllApps?: boolean;
}

export function SnapshotContent({ snapshot, date }: SnapshotContentProps) {
  if (!snapshot || !("schemaVersion" in snapshot) || !isSnapshotV2(snapshot as unknown as DaySnapshot)) {
    return (
      <div className="timeline-empty">
        <h2>Timeline unavailable for this synced day</h2>
        <p>This view only renders the desktop-style proof surface once the synced payload includes snapshot v2 work blocks.</p>
        <Link href={`/chat?date=${date}`} className="timeline-inline-link">
          Ask AI instead
        </Link>
      </div>
    );
  }

  return (
    <TimelineSurface
      snapshots={[{ localDate: date, snapshot: snapshot as unknown as DaySnapshotV2 }]}
      anchorDate={date}
      range="day"
    />
  );
}
