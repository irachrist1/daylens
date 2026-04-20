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
      <div className="sync-row">
        <span className="sync-pill">Checking workspace sync…</span>
      </div>
    );
  }

  if (status.health === "pending_first_sync") {
    return (
      <div className="sync-banner sync-banner--warning">
        Linked, but no synced day has landed yet. Keep Daylens running on your laptop to finish the first sync.
      </div>
    );
  }

  if (status.health === "failed") {
    return (
      <div className="sync-banner sync-banner--error">
        Sync failed{status.latestFailure?.reason ? `: ${status.latestFailure.reason}` : ""}.
        {status.lastHeartbeatAt ? ` Heartbeat is still arriving ${formatRelativeTime(status.lastHeartbeatAt)}.` : ""}
        {status.lastSuccessfulSyncAt ? ` Last durable sync was ${formatRelativeTime(status.lastSuccessfulSyncAt)}.` : ""}
        {!status.lastHeartbeatAt ? " No recent live signal has arrived." : ""}
      </div>
    );
  }

  if (!status.lastHeartbeatAt && !status.lastSuccessfulSyncAt) {
    return (
      <div className="sync-banner sync-banner--warning">
        No heartbeat or durable sync has landed yet.
      </div>
    );
  }

  return (
    <div className="sync-row">
      {status.lastHeartbeatAt ? (
        <span className="sync-pill">Last heartbeat {formatRelativeTime(status.lastHeartbeatAt)}</span>
      ) : null}
      {status.lastSuccessfulSyncAt ? (
        <span className="sync-pill">Last durable sync {formatRelativeTime(status.lastSuccessfulSyncAt)}</span>
      ) : null}
      {status.latestPresence?.state ? (
        <span className="sync-pill sync-pill--strong">
          {status.latestPresence.state}
        </span>
      ) : null}
      {status.latestPresence?.currentBlockLabel ? (
        <span className="sync-pill">
          {status.latestPresence.currentBlockLabel}
        </span>
      ) : null}
      {status.health === "stale" && (
        <span className="sync-pill sync-pill--warning">
          Your laptop has gone stale. Open Daylens to refresh live state.
        </span>
      )}
    </div>
  );
}
