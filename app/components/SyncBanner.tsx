"use client";

import { formatRelativeTime } from "@/app/lib/format";

interface SyncBannerStatus {
  health: "pending_first_sync" | "healthy" | "stale" | "failed";
  lastHeartbeatAt?: number | null;
  lastSuccessfulSyncAt?: number | null;
  latestPresence?: {
    state: string;
    heartbeatAt: number;
    currentBlockLabel?: string | null;
  } | null;
  latestFailure?: {
    reason: string;
    detail?: string | null;
  } | null;
}

export function SyncBanner({ status }: { status?: SyncBannerStatus | null }) {
  if (!status) {
    return (
      <div className="rounded-lg bg-warning/10 px-4 py-2 text-sm text-warning">
        Checking workspace sync status...
      </div>
    );
  }

  if (status.health === "pending_first_sync") {
    return (
      <div className="rounded-lg bg-warning/10 px-4 py-2 text-sm text-warning">
        Linked, but no synced day has landed yet. Keep Daylens running on your laptop to finish the first sync.
      </div>
    );
  }

  if (status.health === "failed") {
    return (
      <div className="rounded-lg bg-error/10 px-4 py-2 text-sm text-error">
        Sync failed{status.latestFailure?.reason ? `: ${status.latestFailure.reason}` : ""}.
        {status.lastHeartbeatAt ? ` Heartbeat is still arriving ${formatRelativeTime(status.lastHeartbeatAt)}.` : ""}
        {status.lastSuccessfulSyncAt ? ` Last durable sync was ${formatRelativeTime(status.lastSuccessfulSyncAt)}.` : ""}
      </div>
    );
  }

  if (!status.lastHeartbeatAt && !status.lastSuccessfulSyncAt) {
    return (
      <div className="rounded-lg bg-warning/10 px-4 py-2 text-sm text-warning">
        No heartbeat or durable sync has landed yet.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
      {status.lastHeartbeatAt ? (
        <span>Last heartbeat {formatRelativeTime(status.lastHeartbeatAt)}</span>
      ) : null}
      {status.lastSuccessfulSyncAt ? (
        <span>Last durable sync {formatRelativeTime(status.lastSuccessfulSyncAt)}</span>
      ) : null}
      {status.latestPresence?.state ? (
        <span className="rounded bg-surface-low px-2 py-0.5 text-on-surface">
          {status.latestPresence.state}
        </span>
      ) : null}
      {status.latestPresence?.currentBlockLabel ? (
        <span className="rounded bg-surface-low px-2 py-0.5 text-on-surface">
          {status.latestPresence.currentBlockLabel}
        </span>
      ) : null}
      {status.health === "stale" && (
        <span className="rounded bg-warning/15 px-2 py-0.5 text-warning">
          Your laptop has gone stale. Open Daylens to refresh live state.
        </span>
      )}
    </div>
  );
}
