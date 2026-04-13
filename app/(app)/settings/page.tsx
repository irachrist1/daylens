import { getSession } from "@/app/lib/session";
import { getConvexClient } from "@/app/lib/convex";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { redirect } from "next/navigation";
import { formatRelativeTime } from "@/app/lib/format";
import { DisconnectButton } from "./DisconnectButton";
import { DownloadButton } from "./DownloadButton";
import { PrivacySection } from "./PrivacySection";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/");

  const client = getConvexClient(session.token);

  const devices = await client.query(api.devices.listByWorkspace, {});

  const snapshots = await client.query(api.snapshots.list, {});

  return (
    <div className="px-4 sm:px-6 py-4 sm:py-8 max-w-2xl mx-auto space-y-4 sm:space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Linked Devices */}
      <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-4">
        <h2 className="text-lg font-semibold">Linked Devices</h2>
        {devices.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No devices linked.</p>
        ) : (
          <div className="space-y-3">
            {devices.map((device: {
              _id: Id<"devices">;
              displayName: string;
              platform: string;
              lastSyncAt: number;
            }) => (
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
            href="/daylens/api/download/windows"
            className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-sm text-primary hover:bg-primary/5 transition-colors"
          >
            Download
          </a>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Daylens for Linux</p>
            <p className="text-xs text-on-surface-variant">
              Required for activity tracking — runs on your Linux machine in the background
            </p>
          </div>
          <a
            href="/daylens/api/download/linux"
            className="rounded-lg border border-outline-variant/20 px-3 py-1.5 text-sm text-primary hover:bg-primary/5 transition-colors"
          >
            Download
          </a>
        </div>
      </section>

      {/* Data */}
      <section className="rounded-2xl glass-card p-4 sm:p-6 space-y-4">
        <h2 className="text-lg font-semibold">Your Data</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Download Data</p>
            <p className="text-xs text-on-surface-variant">
              Export all {snapshots.length} synced days as JSON
            </p>
          </div>
          <DownloadButton />
        </div>
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
          <a
            href="/recover"
            className="text-sm text-primary hover:underline"
          >
            Recover a different workspace
          </a>
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
          <form action="/api/logout" method="POST">
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
