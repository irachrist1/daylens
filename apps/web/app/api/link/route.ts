import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/app/lib/convex";
import { setSessionCookie } from "@/app/lib/session";
import { api } from "../../../convex/_generated/api";
import { randomUUID } from "node:crypto";

export async function POST(request: NextRequest) {
  const { token } = await request.json();

  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  const client = getConvexClient();
  const result = await client.action(api.linkCodes.redeemAndIssueSession, {
    token,
    deviceId: `web-${randomUUID()}`,
    displayName: "Web Browser",
  });

  if (!result.success) {
    return NextResponse.json(
      { error: result.error || "Failed to redeem code" },
      { status: 400 }
    );
  }

  const response = NextResponse.json({ success: true });
  response.headers.set(
    "Set-Cookie",
    setSessionCookie(result.token)
  );

  return response;
}
