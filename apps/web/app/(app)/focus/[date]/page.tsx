import { getSession } from "@/app/lib/session";
import { getConvexClient } from "@/app/lib/convex";
import { api } from "../../../../convex/_generated/api";
import { redirect } from "next/navigation";
import { formatDuration, formatFullDate } from "@/app/lib/format";
import Link from "next/link";
import { appPath } from "@/app/lib/basePath";

export default async function FocusPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const session = await getSession();
  if (!session) redirect(appPath("/"));

  const client = getConvexClient(session.token);
  const snapshotDoc = await client.query(api.remoteSync.getTimelineDay, {
    localDate: date,
  });

  const snapshot = snapshotDoc?.snapshot;
  const focusSessions = snapshot?.focusSessions || [];

  return (
    <div className="px-4 sm:px-6 py-4 sm:py-8 max-w-2xl mx-auto space-y-4 sm:space-y-6">
      <Link href={`/apps/${date}`} className="text-sm text-primary hover:underline">
        &larr; {formatFullDate(date)}
      </Link>
      <h1 className="text-2xl font-bold">Focus Sessions</h1>

      {focusSessions.length === 0 ? (
        <div className="rounded-2xl glass-card p-8 text-center">
          <p className="text-on-surface-variant">No focus sessions this day.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {focusSessions.map(
            (
              session: {
                sourceId: string;
                startAt: string;
                endAt: string;
                actualDurationSec: number;
                targetMinutes: number;
                status: string;
              },
              i: number
            ) => {
              const startTime = new Date(session.startAt).toLocaleTimeString(
                undefined,
                { hour: "2-digit", minute: "2-digit" }
              );
              const endTime = new Date(session.endAt).toLocaleTimeString(
                undefined,
                { hour: "2-digit", minute: "2-digit" }
              );
              const statusColor =
                session.status === "completed"
                  ? "text-success"
                  : session.status === "active"
                    ? "text-primary"
                    : "text-on-surface-variant";
              const statusLabel =
                session.status === "completed"
                  ? "Completed"
                  : session.status === "active"
                    ? "Active"
                    : "Cancelled";

              return (
                <div
                  key={session.sourceId || i}
                  className="rounded-2xl glass-card p-5 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-primary-container/20 flex items-center justify-center">
                        <svg
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          className="text-primary"
                        >
                          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {startTime} – {endTime}
                        </p>
                        <p className="text-xs text-on-surface-variant">
                          Target: {session.targetMinutes}m
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">
                        {formatDuration(session.actualDurationSec)}
                      </p>
                      <p className={`text-xs font-medium ${statusColor}`}>
                        {statusLabel}
                      </p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="h-1.5 rounded-full bg-surface-high overflow-hidden">
                    <div
                      className="h-full rounded-full focus-bar"
                      style={{
                        width: `${Math.min(100, (session.actualDurationSec / (session.targetMinutes * 60)) * 100)}%`,
                        backgroundColor:
                          session.status === "completed"
                            ? "#34d399"
                            : "#b4c5ff",
                      }}
                    />
                  </div>
                </div>
              );
            }
          )}
        </div>
      )}
    </div>
  );
}
