import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/app/lib/convex";
import { getSession } from "@/app/lib/session";
import { api } from "../../../convex/_generated/api";

function normalizeOutputs(candidate: unknown): Array<"report" | "csv" | "chart"> | undefined {
  if (!Array.isArray(candidate)) return undefined;
  const outputs = candidate.filter(
    (value): value is "report" | "csv" | "chart" =>
      value === "report" || value === "csv" || value === "chart"
  );
  return outputs.length > 0 ? Array.from(new Set(outputs)) : undefined;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const client = getConvexClient(session.token);
  const threadId = request.nextUrl.searchParams.get("threadId");

  const artifacts = threadId
    ? await client.query(api.webAiArtifacts.listByThread, {
        workspaceThreadId: threadId,
      })
    : await client.query(api.webAiArtifacts.listRecent, {});

  return NextResponse.json({ artifacts });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json();
  const threadId =
    typeof body.threadId === "string" && body.threadId.trim()
      ? body.threadId.trim()
      : undefined;

  const client = getConvexClient(session.token);
  let localDate =
    typeof body.date === "string" && body.date.trim()
      ? body.date.trim()
      : null;

  if (!localDate) {
    localDate = await client.query(api.remoteSync.latestTimelineDate, {});
  }

  if (!localDate) {
    return NextResponse.json(
      {
        error:
          "No synced activity data is available yet. Open Daylens on your computer and let it sync first.",
      },
      { status: 400 }
    );
  }

  try {
    const result = await client.action(api.webAiArtifacts.generateDayArtifacts, {
      localDate,
      workspaceThreadId: threadId,
      outputs: normalizeOutputs(body.outputs),
    });
    return NextResponse.json(result);
  } catch (error) {
    const raw = error instanceof Error ? error.message : "";
    console.error("[ai-artifacts] generation failed:", raw);

    const userMessage = raw.includes("No synced activity data")
      ? `No activity data found for ${localDate}. Make sure Daylens is running on your computer and synced that day.`
      : "Couldn't generate artifacts right now. Please try again.";

    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}
