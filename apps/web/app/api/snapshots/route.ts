import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/app/lib/convex";
import { getSession } from "@/app/lib/session";
import { api } from "../../../convex/_generated/api";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const full = searchParams.get("full");

  const client = getConvexClient(session.token);

  if (date) {
    const snapshot = await client.query(api.remoteSync.getTimelineDay, {
      localDate: date,
    });
    return NextResponse.json({ snapshot });
  }

  if (from && to) {
    const snapshots = await client.query(api.remoteSync.getTimelineRange, {
      startDate: from,
      endDate: to,
    });
    return NextResponse.json({ snapshots });
  }

  if (full === "1") {
    const snapshots = await client.query(api.snapshots.list, {});
    return NextResponse.json({ snapshots });
  }

  const summaries = await client.query(api.remoteSync.listTimelineSummaries, {});
  return NextResponse.json({ summaries });
}
