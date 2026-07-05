import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/app/lib/convex";
import { getSession } from "@/app/lib/session";
import { api } from "../../../convex/_generated/api";

type KeyErrorCode = "not_authenticated" | "invalid_format" | "unknown";

function errorResponse(code: KeyErrorCode, message: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return errorResponse("not_authenticated", "Not authenticated", 401);
  }

  try {
    const client = getConvexClient(session.token);
    const status = await client.query(api.encryptedKeys.getKeyStatus, {});
    return NextResponse.json(status);
  } catch (error) {
    console.error("[ai-key] status failed:", error instanceof Error ? error.message : error);
    return errorResponse(
      "unknown",
      "Couldn't read key status. Please try again in a moment.",
      500,
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return errorResponse("not_authenticated", "Not authenticated", 401);
  }

  const body = await request.json().catch(() => ({}));
  const rawKey = typeof body?.anthropicKey === "string" ? body.anthropicKey : "";
  if (!rawKey.trim()) {
    return errorResponse("invalid_format", "API key is required.", 400);
  }

  try {
    const client = getConvexClient(session.token);
    const result = await client.action(api.keysPublic.saveAnthropicKey, {
      anthropicKey: rawKey,
    });

    if (!result.ok) {
      return errorResponse(
        "invalid_format",
        "That doesn't look like an Anthropic API key. It should start with sk-ant- followed by a long token.",
        400,
      );
    }

    return NextResponse.json({ ok: true, updatedAt: result.updatedAt });
  } catch (error) {
    // Never forward the raw error body — Convex validator errors could echo args.
    console.error("[ai-key] save failed:", error instanceof Error ? error.message : error);
    return errorResponse(
      "unknown",
      "Couldn't save the key. Please try again in a moment.",
      500,
    );
  }
}

export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return errorResponse("not_authenticated", "Not authenticated", 401);
  }

  try {
    const client = getConvexClient(session.token);
    await client.mutation(api.encryptedKeys.deleteAnthropicKey, {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[ai-key] delete failed:", error instanceof Error ? error.message : error);
    return errorResponse(
      "unknown",
      "Couldn't remove the key. Please try again in a moment.",
      500,
    );
  }
}
