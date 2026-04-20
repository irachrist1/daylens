import { getSession } from "@/app/lib/session";
import { getConvexClient } from "@/app/lib/convex";
import { api } from "../../../../convex/_generated/api";
import { redirect } from "next/navigation";
import Link from "next/link";
import { formatFullDate } from "@/app/lib/format";
import { AppsDayClient } from "@/app/components/AppsDayClient";
import { isSnapshotV2 } from "../../../../packages/remote-contract";

export default async function AppsPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const session = await getSession();
  if (!session) redirect("/");

  const client = getConvexClient(session.token);
  const snapshotDoc = await client.query(api.remoteSync.getTimelineDay, {
    localDate: date,
  });

  const snapshot = snapshotDoc?.snapshot;

  if (!snapshot) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Link href="/dashboard" className="text-sm text-primary hover:underline">
          &larr; Timeline
        </Link>
        <h1 className="mt-4 text-2xl font-bold">{formatFullDate(date)}</h1>
        <div className="mt-4 rounded-2xl glass-card p-8 text-center">
          <p className="text-on-surface-variant">No data for this day.</p>
        </div>
      </div>
    );
  }

  if (!isSnapshotV2(snapshot)) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Link href="/dashboard" className="text-sm text-primary hover:underline">
          &larr; Timeline
        </Link>
        <h1 className="mt-4 text-2xl font-bold">{formatFullDate(date)}</h1>
        <div className="mt-4 rounded-2xl glass-card p-8 text-center">
          <p className="text-on-surface-variant">This synced day still needs the newer apps detail format.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <AppsDayClient snapshot={snapshot} date={date} />
    </div>
  );
}
