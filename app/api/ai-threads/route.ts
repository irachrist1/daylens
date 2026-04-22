import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/app/lib/convex";
import { getSession } from "@/app/lib/session";
import { api } from "../../../convex/_generated/api";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const client = getConvexClient(session.token);
  const threads = await client.query(api.webAiThreads.listThreads, {});
  return NextResponse.json({ threads });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const threadId = request.nextUrl.searchParams.get("threadId")?.trim();
  if (!threadId) {
    return NextResponse.json({ error: "Missing thread id." }, { status: 400 });
  }

  try {
    const client = getConvexClient(session.token);
    await client.mutation((api as any).webAiThreads.archiveThread, {
      workspaceThreadId: threadId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "[ai-threads] archive failed:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Couldn't archive that chat. Please try again in a moment." },
      { status: 500 },
    );
  }
}
