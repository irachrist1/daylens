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
  try {
    const prefs = await client.query(api.preferences.get, {});
    return NextResponse.json(prefs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[preferences GET] Convex query failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json() as { action?: string; appKey?: string; domain?: string; pinHash?: string };
  const { action, appKey, domain, pinHash } = body;
  const client = getConvexClient(session.token);

  try {
    if (action === "hideApp" && appKey) {
      await client.mutation(api.preferences.hideApp, { appKey });
    } else if (action === "showApp" && appKey) {
      await client.mutation(api.preferences.showApp, { appKey });
    } else if (action === "hideDomain" && domain) {
      await client.mutation(api.preferences.hideDomain, { domain });
    } else if (action === "showDomain" && domain) {
      await client.mutation(api.preferences.showDomain, { domain });
    } else if (action === "setPin" && pinHash) {
      await client.mutation(api.preferences.setPrivacyPin, { pinHash });
    } else if (action === "clearPin") {
      await client.mutation(api.preferences.clearPrivacyPin, {});
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[preferences PATCH] Convex mutation failed:", { action, message });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
