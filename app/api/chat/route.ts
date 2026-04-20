import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/app/lib/convex";
import { getSession } from "@/app/lib/session";
import { api } from "../../../convex/_generated/api";

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

  // Support both formats: { messages: [...] } from GlobalChat, or { question, date }
  let question: string | undefined;
  let date: string | undefined;

  if (Array.isArray(body.messages)) {
    const lastUserMsg = [...body.messages]
      .reverse()
      .find((m: { role: string; content?: string }) => m.role === "user");
    question = lastUserMsg?.content;
    date = body.date;
  } else {
    question = body.question;
    date = body.date;
  }

  if (!question) {
    return NextResponse.json(
      { error: "Please type a question." },
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
      },
      { status: 400 }
    );
  }

  try {
    const result = await client.action(api.ai.askQuestion, {
      question,
      date,
      threadId,
    });

    return NextResponse.json(result);
  } catch (error) {
    // Classify the error without leaking internals
    const raw =
      error instanceof Error ? error.message : "";

    // Log full error server-side for debugging
    console.error("[chat] AI action failed:", raw);

    // Only surface safe, user-actionable messages
    const isKeyError =
      raw.includes("API key") ||
      raw.includes("authentication") ||
      raw.includes("401") ||
      raw.includes("invalid_api_key") ||
      raw.includes("CONVEX_ENCRYPTION_SECRET");

    const isNotDeployed =
      raw.includes("Could not find") ||
      raw.includes("is not a function") ||
      raw.includes("npx");

    const isNoData =
      raw.includes("No activity data");

    const isBillingError =
      raw.includes("credit balance is too low") ||
      raw.includes("billing") ||
      raw.includes("purchase credits") ||
      raw.includes("insufficient credits");

    const isUsageLimit =
      raw.includes("rate_limit") ||
      raw.includes("usage limit") ||
      raw.includes("overloaded_error");

    let userMessage: string;
    if (isKeyError) {
      userMessage =
        "Your API key isn't set up yet. Open Daylens on your computer, go to Settings, and save your Anthropic API key.";
    } else if (isBillingError) {
      userMessage =
        "Your Anthropic API key is linked, but the provider account does not have enough credits right now. Top up that key or switch providers in Daylens on your computer.";
    } else if (isUsageLimit) {
      userMessage =
        "The AI provider is rate-limiting this workspace right now. Try again in a few minutes.";
    } else if (isNotDeployed) {
      userMessage =
        "The AI service is being updated. Please try again in a few minutes.";
    } else if (isNoData) {
      userMessage =
        `No activity data found for ${date}. Make sure Daylens is running on your computer and synced that day.`;
    } else {
      userMessage =
        "Something went wrong. Please try again.";
    }

    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}
