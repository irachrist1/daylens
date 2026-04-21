import { NextRequest, NextResponse } from "next/server";
import { getConvexClient } from "@/app/lib/convex";
import { setSessionCookie } from "@/app/lib/session";
import { api } from "../../../convex/_generated/api";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
}

function base32Encode(data: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let result = "";
  let bits = 0;
  let buffer = 0;

  for (const byte of data) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(buffer >> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    result += alphabet[(buffer << (5 - bits)) & 0x1f];
  }

  return result;
}

function deriveWorkspaceId(mnemonic: string): string {
  const normalized = normalizeMnemonic(mnemonic);
  const input = "daylens-workspace-v1:" + normalized;
  const hash = createHash("sha256").update(input).digest();
  return `ws_${base32Encode(hash).slice(0, 26).toLowerCase()}`;
}

function getRecoveryKeyHashes(mnemonic: string): string[] {
  const normalized = normalizeMnemonic(mnemonic);
  const workspaceId = deriveWorkspaceId(normalized);
  const desktopCompatibleHash = sha256Hex(workspaceId);
  const legacyMnemonicHash = sha256Hex(`daylens-workspace-v1:${normalized}`);

  return desktopCompatibleHash === legacyMnemonicHash
    ? [desktopCompatibleHash]
    : [desktopCompatibleHash, legacyMnemonicHash];
}

export async function POST(request: NextRequest) {
  const { mnemonic } = await request.json();

  if (!mnemonic || typeof mnemonic !== "string") {
    return NextResponse.json(
      { error: "Recovery phrase is required" },
      { status: 400 }
    );
  }

  const words = mnemonic.trim().toLowerCase().split(/\s+/);
  if (words.length !== 12) {
    return NextResponse.json(
      { error: "Recovery phrase must be exactly 12 words" },
      { status: 400 }
    );
  }

  const client = getConvexClient();
  const deviceId = `web-${randomUUID()}`;
  const displayName = "Recovered Web Browser";

  for (const recoveryKeyHash of getRecoveryKeyHashes(mnemonic)) {
    const result = await client.action(api.workspaces.recoverAndIssueSession, {
      recoveryKeyHash,
      deviceId,
      displayName,
    });

    if (result.success) {
      const response = NextResponse.json({ success: true });
      response.headers.set(
        "Set-Cookie",
        setSessionCookie(result.token)
      );
      return response;
    }
  }

  return NextResponse.json(
    { error: "No workspace found for this recovery phrase" },
    { status: 404 }
  );
}
