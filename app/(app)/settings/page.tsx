import { getSession } from "@/app/lib/session";
import { getConvexClient } from "@/app/lib/convex";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { redirect } from "next/navigation";
import { formatRelativeTime } from "@/app/lib/format";
import Link from "next/link";
import { DisconnectButton } from "./DisconnectButton";
import { DownloadButton } from "./DownloadButton";
import { PrivacySection } from "./PrivacySection";
import {
  LINUX_STATUS_HREF,
  WINDOWS_DOWNLOAD_HREF,
} from "@/app/lib/platformLinks";
import { apiPath } from "@/app/lib/basePath";
import { StatusNotice } from "@/app/components/StatusNotice";
import { getRemoteIssueCopy, readErrorMessage } from "@/app/lib/remoteUi";
import { appPath } from "@/app/lib/basePath";

type Device = {
  _id: Id<"devices">;
  displayName: string;
  platform: string;
  lastSyncAt: number;
};

type WorkspaceStatus = {
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
};

type TimelineSummary = {
  localDate: string;
  syncedAt?: number | null;
};

type SettingsQueryResult<T> = {
  data: T | null;
  error: string | null;
};

async function querySafely<T>(run: () => Promise<T>): Promise<SettingsQueryResult<T>> {
  try {
    return { data: await run(), error: null };
  } catch (error) {
    return { data: null, error: readErrorMessage(error) };
  }
}

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect(appPath("/"));

  const client = getConvexClient(session.token);

  const [
    { data: devices, error: devicesError },
    { data: workspaceStatus, error: workspaceStatusError },
    { data: snapshots, error: snapshotsError },
  ] = await Promise.all([
    querySafely(() => client.query(api.devices.listByWorkspace, {})),
    querySafely(() => client.query(api.remoteSync.getWorkspaceStatus, {})),
    querySafely(() => client.query(api.remoteSync.listTimelineSummaries, {})),
  ]);

  const devicesList = devices ?? [];
  const workspaceHealth = workspaceStatus as WorkspaceStatus | null;
  const snapshotList = (snapshots ?? []) as TimelineSummary[];
  const topIssue = devicesError || workspaceStatusError || snapshotsError
    ? getRemoteIssueCopy(devicesError || workspaceStatusError || snapshotsError, {
        title: "Some workspace details are unavailable",
        detail:
          "This browser is linked, but parts of Settings could not load right now.",
      })
    : null;
  const devicesIssue = devicesError
    ? getRemoteIssueCopy(devicesError, {
        title: "Linked devices are unavailable",
        detail:
          "Settings could not load the linked-device list from the current backend.",
      })
    : null;
  const workspaceStatusIssue = workspaceStatusError
    ? getRemoteIssueCopy(workspaceStatusError, {
        title: "Sync health is unavailable",
        detail:
          "Settings could not load the current remote sync state from the backend.",
      })
    : null;
  const snapshotsIssue = snapshotsError
    ? getRemoteIssueCopy(snapshotsError, {
        title: "Synced day summaries are unavailable",
        detail:
          "Settings could not load synced-day counts from the current backend.",
      })
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-4 sm:px-6 sm:py-8 sm:space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {topIssue ? (
        <StatusNotice title={topIssue.title} detail={topIssue.detail} tone={topIssue.tone} />
      ) : (
        <StatusNotice
          title="This browser is linked"
          detail="Use Settings to check linked devices, sync health, privacy controls, and whether synced timeline data has started arriving."
        />
      )}

      {/* Linked Devices */}
      <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-4">
        <h2 className="text-lg font-semibold">Linked Devices</h2>
        {workspaceHealth ? (
          <div className="rounded-xl bg-surface-low px-3 py-2 text-sm text-on-surface-variant">
            Sync health: <span className="font-medium text-on-surface">{workspaceHealth.health}</span>
            {workspaceHealth.lastHeartbeatAt
              ? ` · last heartbeat ${formatRelativeTime(workspaceHealth.lastHeartbeatAt)}`
              : ""}
            {workspaceHealth.lastSuccessfulSyncAt
              ? ` · last durable sync ${formatRelativeTime(workspaceHealth.lastSuccessfulSyncAt)}`
              : ""}
            {workspaceHealth.health === "failed" && workspaceHealth.latestFailure?.reason
              ? ` · latest failure ${workspaceHealth.latestFailure.reason}`
              : ""}
          </div>
        ) : workspaceStatusIssue ? (
          <StatusNotice
            title={workspaceStatusIssue.title}
            detail={workspaceStatusIssue.detail}
            tone={workspaceStatusIssue.tone}
          />
        ) : null}
        {devicesIssue ? (
          <StatusNotice
            title={devicesIssue.title}
            detail={devicesIssue.detail}
            tone={devicesIssue.tone}
          />
        ) : devicesList.length === 0 ? (
          <p className="text-sm text-on-surface-variant">
            No linked devices are visible yet. If you just connected this browser, give the desktop app a moment to report in.
          </p>
        ) : (
          <div className="space-y-3">
            {devicesList.map((device: Device) => (
              <div
                key={device._id}
                className="flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-medium">{device.displayName}</p>
                  <p className="text-xs text-on-surface-variant">
                    {device.platform} · Last sync{" "}
                    {formatRelativeTime(device.lastSyncAt)}
                  </p>
                </div>
                <DisconnectButton deviceId={device._id} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Privacy */}
      <PrivacySection />

      {/* Download desktop apps */}
      <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-4">
        <h2 className="text-lg font-semibold">Get the Desktop App</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Daylens for Windows</p>
            <p className="text-xs text-on-surface-variant">
              Required for activity tracking — runs on your PC in the background
            </p>
          </div>
          <a
            href={WINDOWS_DOWNLOAD_HREF}
            className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-sm text-primary hover:bg-primary/5 transition-colors"
          >
            Download
          </a>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Daylens for Linux</p>
            <p className="text-xs text-on-surface-variant">
              Part of the unified Daylens direction, with installer rollout and validation still in transition
            </p>
          </div>
          <a
            href={LINUX_STATUS_HREF}
            className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-sm text-primary hover:bg-primary/5 transition-colors"
          >
            Status
          </a>
        </div>
      </section>

      {/* Data */}
      <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-4">
        <h2 className="text-lg font-semibold">Your Data</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Download Data</p>
            {snapshotsIssue ? (
              <p className="text-xs text-on-surface-variant">
                Synced day summaries are unavailable from the current backend, so export is temporarily disabled.
              </p>
            ) : snapshotList.length === 0 ? (
              <p className="text-xs text-on-surface-variant">
                This browser is linked, but Daylens is still waiting for the first synced day before export becomes useful.
              </p>
            ) : (
              <p className="text-xs text-on-surface-variant">
                Export all {snapshotList.length} synced day{snapshotList.length === 1 ? "" : "s"} as JSON
              </p>
            )}
          </div>
          <DownloadButton disabled={Boolean(snapshotsIssue) || snapshotList.length === 0} />
        </div>
        {snapshotsIssue ? (
          <StatusNotice
            title={snapshotsIssue.title}
            detail={snapshotsIssue.detail}
            tone={snapshotsIssue.tone}
          />
        ) : null}
      </section>

      {/* Recovery */}
      <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-4">
        <h2 className="text-lg font-semibold">Account</h2>
        <div className="space-y-2">
          {session.workspaceId && (
            <p className="text-sm text-on-surface-variant">
              Workspace ID: {session.workspaceId}
            </p>
          )}
          <Link href="/recover" className="text-sm text-primary hover:underline">
            Recover a different workspace
          </Link>
        </div>
      </section>

      {/* Disconnect */}
      <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-4">
        <h2 className="text-lg font-semibold text-error">Danger Zone</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Disconnect Web Browser</p>
            <p className="text-xs text-on-surface-variant">
              Removes session cookie. Your desktop app data remains.
            </p>
          </div>
          <form action={apiPath("/api/logout")} method="POST">
            <button
              type="submit"
              className="rounded-lg border border-error/30 px-3 py-1.5 text-sm text-error hover:bg-error/10 transition-colors"
            >
              Disconnect
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
