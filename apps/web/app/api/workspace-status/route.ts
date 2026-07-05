import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { getConvexClient } from "@/app/lib/convex";
import { api } from "../../../convex/_generated/api";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const client = getConvexClient(session.token);
  const status = await client.query(api.remoteSync.getWorkspaceStatus, {});
  return NextResponse.json({ status });
}
