"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import * as crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_DERIVATION_INFO = "daylens-anthropic-key:v2";

function getLegacyEncryptionKey(): Buffer {
  const secret = process.env.CONVEX_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("CONVEX_ENCRYPTION_SECRET not set");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function getEncryptionKey(workspaceId: string): Buffer {
  const secret = process.env.CONVEX_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("CONVEX_ENCRYPTION_SECRET not set");
  }

  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.from(workspaceId, "utf8"),
      Buffer.from(KEY_DERIVATION_INFO, "utf8"),
      32
    )
  );
}

function encrypt(plaintext: string, workspaceId: string): string {
  const key = getEncryptionKey(workspaceId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();
  return `v2:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

function decryptWithKey(encryptedStr: string, key: Buffer): string {
  const [ivB64, tagB64, ciphertext] = encryptedStr.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function decrypt(encryptedStr: string, workspaceId: string): string {
  if (encryptedStr.startsWith("v2:")) {
    return decryptWithKey(encryptedStr.slice(3), getEncryptionKey(workspaceId));
  }

  return decryptWithKey(encryptedStr, getLegacyEncryptionKey());
}

export const store = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    anthropicKey: v.string(),
    updatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const encrypted = encrypt(args.anthropicKey, args.workspaceId);
    await ctx.runMutation(internal.keysMutations.upsertEncryptedKey, {
      workspaceId: args.workspaceId,
      encryptedAnthropicKey: encrypted,
      updatedAt: args.updatedAt ?? Date.now(),
    });
    return { success: true };
  },
});
