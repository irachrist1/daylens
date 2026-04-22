import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/app/lib/convex";
import { getSession } from "@/app/lib/session";
import { api } from "../../../convex/_generated/api";

type ChatErrorCode =
  | "not_authenticated"
  | "empty_question"
  | "no_data"
  | "missing_key"
  | "billing_exhausted"
  | "rate_limited"
  | "service_updating"
  | "unknown";

type ChatRange = "day" | "week" | "month";

/**
 * Strip anything that looks like an Anthropic API key or a userApiKey field
 * from an error string before returning it to the browser. Convex includes
 * the full args object in ArgumentValidationError messages, which would
 * otherwise leak the BYO key back to the client.
 */
function redactSecrets(raw: string): string {
  if (!raw) return raw;
  return raw
    .replace(/sk-[a-zA-Z0-9\-_]{10,}/g, "sk-***redacted***")
    .replace(/"userApiKey"\s*:\s*"[^"]*"/g, '"userApiKey":"***redacted***"')
    .replace(/userApiKey:\s*"[^"]*"/g, 'userApiKey:"***redacted***"');
}

/**
 * The deployed Convex validator is sometimes behind this repo (needs
 * `npx convex deploy` to catch up with new optional args). Detect the
 * "extra field X is not in the validator" shape so we can retry with a
 * narrower arg set automatically.
 */
function isExtraFieldValidatorError(raw: string): boolean {
  return (
    raw.includes("ArgumentValidationError") &&
    /extra field [`"'][^`"']+[`"'] that is not in the validator/.test(raw)
  );
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "Not authenticated", code: "not_authenticated" satisfies ChatErrorCode },
      { status: 401 },
    );
  }

  const body = await request.json();
  const threadId =
    typeof body.threadId === "string" && body.threadId.trim()
      ? body.threadId.trim()
      : undefined;
  const userApiKey =
    typeof body.userApiKey === "string" && body.userApiKey.trim()
      ? body.userApiKey.trim()
      : undefined;
  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : undefined;

  // Support both formats: { messages: [...] } from GlobalChat, or { question, date }
  let question: string | undefined;
  let date: string | undefined;
  let range: ChatRange | undefined;

  if (Array.isArray(body.messages)) {
    const lastUserMsg = [...body.messages]
      .reverse()
      .find((m: { role: string; content?: string }) => m.role === "user");
    question = lastUserMsg?.content;
    date = body.date;
    range = body.range === "week" || body.range === "month" ? body.range : "day";
  } else {
    question = body.question;
    date = body.date;
    range = body.range === "week" || body.range === "month" ? body.range : "day";
  }

  if (!question) {
    return NextResponse.json(
      { error: "Please type a question.", code: "empty_question" satisfies ChatErrorCode },
      { status: 400 }
    );
  }

  const client = getConvexClient(session.token);

  if (!date) {
    date = await client.query(api.remoteSync.latestTimelineDate, {});
  }

  if (!date) {
    return NextResponse.json(
      {
        error:
          "No synced activity data is available yet. Open Daylens on your computer and let it sync first.",
        code: "no_data" satisfies ChatErrorCode,
      },
      { status: 400 }
    );
  }

  async function callAction(args: Record<string, unknown>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return client.action(api.ai.askQuestion, args as any);
  }

  try {
    let result;
    try {
      result = await callAction({ question, date, range, threadId, userApiKey, model });
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      // If the deployed Convex validator doesn't know about the new optional
      // args yet, retry with only the fields it definitely accepts. This
      // keeps /chat working before `npx convex deploy` is run.
      if (isExtraFieldValidatorError(raw)) {
        console.warn("[chat] narrow-retry after validator rejected extra fields");
        result = await callAction({ question, date, threadId });
      } else {
        throw error;
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    const rawUnsafe = error instanceof Error ? error.message : "";
    const raw = redactSecrets(rawUnsafe);

    // Log the full (but redacted) error server-side for debugging
    console.error("[chat] AI action failed:", raw);

    const rawLower = raw.toLowerCase();

    const isKeyError =
      raw.includes("API key") ||
      rawLower.includes("authentication") ||
      raw.includes("401") ||
      raw.includes("invalid_api_key") ||
      raw.includes("CONVEX_ENCRYPTION_SECRET");

    const isNotDeployed =
      raw.includes("Could not find") ||
      rawLower.includes("is not a function") ||
      rawLower.includes("npx") ||
      rawLower.includes("deployment") ||
      rawLower.includes("argumentvalidationerror");

    const isNoData =
      raw.includes("No activity data") ||
      rawLower.includes("no snapshot");

    const isBillingError =
      rawLower.includes("credit balance is too low") ||
      rawLower.includes("billing") ||
      rawLower.includes("purchase credits") ||
      rawLower.includes("insufficient credits");

    const isUsageLimit =
      rawLower.includes("rate_limit") ||
      rawLower.includes("rate-limit") ||
      rawLower.includes("usage limit") ||
      rawLower.includes("overloaded_error") ||
      rawLower.includes("429");

    const isModelError =
      rawLower.includes("model") &&
      (rawLower.includes("not_found") ||
        rawLower.includes("does not exist") ||
        rawLower.includes("invalid_request_error") ||
        rawLower.includes("deprecated"));

    let userMessage: string;
    let code: ChatErrorCode;
    if (isKeyError) {
      code = "missing_key";
      userMessage =
        "Your API key isn't set up yet. Open Settings → AI Provider and save an Anthropic key, or configure one on the desktop app.";
    } else if (isBillingError) {
      code = "billing_exhausted";
      userMessage =
        "Your Anthropic API key is linked, but the provider account does not have enough credits right now. Top up that key or switch providers.";
    } else if (isUsageLimit) {
      code = "rate_limited";
      userMessage =
        "The AI provider is rate-limiting this workspace right now. Try again in a few minutes.";
    } else if (isNotDeployed) {
      code = "service_updating";
      userMessage =
        "The AI service is being updated. Please try again in a minute.";
    } else if (isNoData) {
      code = "no_data";
      userMessage =
        `No activity data found for ${date}. Make sure Daylens is running on your computer and synced that day.`;
    } else if (isModelError) {
      code = "service_updating";
      userMessage =
        "The AI model is currently unavailable. Try again in a minute or pick a different model in Settings.";
    } else {
      code = "unknown";
      userMessage =
        "Daylens couldn't reach the AI provider. Please try again in a moment.";
    }

    return NextResponse.json({ error: userMessage, code }, { status: 500 });
  }
}
