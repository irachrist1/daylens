import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/app/lib/convex";
import { normalizeChatMessages, toModelMessages } from "@/app/lib/chat";
import { getSession } from "@/app/lib/session";
import { api } from "../../../convex/_generated/api";

type ChatErrorCode =
  | "not_authenticated"
  | "empty_question"
  | "no_data"
  | "missing_key"
  | "billing_exhausted"
  | "rate_limited"
  | "model_not_allowed"
  | "service_updating"
  | "invalid_request"
  | "unknown";

type ChatRange = "day" | "week" | "month";

function errorResponse(code: ChatErrorCode, message: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

function statusForCode(code: ChatErrorCode): number {
  switch (code) {
    case "billing_exhausted":
      return 402;
    case "rate_limited":
      return 429;
    case "no_data":
    case "missing_key":
    case "model_not_allowed":
      return 400;
    case "service_updating":
      return 503;
    case "invalid_request":
      return 400;
    default:
      return 500;
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return errorResponse("not_authenticated", "Not authenticated", 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_request", "Invalid JSON request body.", 400);
  }
  if (!body || typeof body !== "object") {
    return errorResponse("invalid_request", "Invalid chat request body.", 400);
  }
  const payload = body as Record<string, unknown>;
  const threadId =
    typeof payload.threadId === "string" && payload.threadId.trim()
      ? payload.threadId.trim()
      : undefined;
  const model =
    typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : undefined;

  let question: string | undefined;
  let date: string | undefined;
  let range: ChatRange | undefined;
  let messages: ReturnType<typeof toModelMessages> | undefined;

  if (Array.isArray(payload.messages)) {
    const normalizedMessages = normalizeChatMessages(payload.messages);
    messages = toModelMessages(normalizedMessages);
    const lastUserMsg = [...normalizedMessages]
      .reverse()
      .find((m) => m.role === "user");
    question = lastUserMsg?.content;
    date = typeof payload.date === "string" ? payload.date : undefined;
    range = payload.range === "week" || payload.range === "month" ? payload.range : "day";
  } else {
    question = typeof payload.question === "string" ? payload.question : undefined;
    date = typeof payload.date === "string" ? payload.date : undefined;
    range = payload.range === "week" || payload.range === "month" ? payload.range : "day";
  }

  question = question?.trim();
  if (!question) {
    return errorResponse("empty_question", "Please type a question.", 400);
  }

  const client = getConvexClient(session.token);

  if (!date) {
    date = await client.query(api.remoteSync.latestTimelineDate, {});
  }

  if (!date) {
    return errorResponse(
      "no_data",
      "No synced activity data is available yet. Open Daylens on your computer and let it sync first.",
      400,
    );
  }

  try {
    const result = await client.action(api.ai.askQuestion, {
      question,
      date,
      range,
      threadId,
      model,
      messages,
    });

    if (!result.ok) {
      return errorResponse(result.code, result.message, statusForCode(result.code));
    }

    return NextResponse.json({
      response: result.response,
      threadId: result.threadId,
      provider: result.provider,
      model: result.model,
    });
  } catch (error) {
    // Only truly unexpected failures land here (network, validator drift on a
    // shape we thought was stable, server bug). Never echo the raw message.
    console.error(
      "[chat] unexpected failure:",
      error instanceof Error ? error.message : error,
    );
    return errorResponse(
      "service_updating",
      "The AI service is temporarily unavailable. Please try again in a minute.",
      503,
    );
  }
}
