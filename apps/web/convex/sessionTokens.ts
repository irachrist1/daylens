"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { importJWK, type JWK, SignJWT } from "jose";
import {
  SESSION_JWT_ALGORITHM,
  SESSION_JWT_AUDIENCE,
  SESSION_JWT_ISSUER,
} from "./sessionConfig";

const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

function getPrivateJwk(): JWK {
  const raw = process.env.DAYLENS_SESSION_JWT_PRIVATE_JWK;
  if (!raw) {
    throw new Error("DAYLENS_SESSION_JWT_PRIVATE_JWK not set");
  }

  const jwk = JSON.parse(raw) as JWK;
  if (!jwk.kid) {
    jwk.kid = "daylens-session-key";
  }
  return jwk;
}

export const issue = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    deviceId: v.string(),
    sessionKind: v.union(v.literal("desktop"), v.literal("web")),
  },
  handler: async (_ctx, args) => {
    const privateJwk = getPrivateJwk();
    const signingKey = await importJWK(privateJwk, SESSION_JWT_ALGORITHM);
    const now = Math.floor(Date.now() / 1000);

    const token = await new SignJWT({
      workspaceId: args.workspaceId,
      deviceId: args.deviceId,
      sessionKind: args.sessionKind,
    })
      .setProtectedHeader({
        alg: SESSION_JWT_ALGORITHM,
        kid: privateJwk.kid,
        typ: "JWT",
      })
      .setIssuer(SESSION_JWT_ISSUER)
      .setAudience(SESSION_JWT_AUDIENCE)
      .setSubject(`${args.workspaceId}:${args.deviceId}`)
      .setIssuedAt(now)
      .setExpirationTime(now + SESSION_LIFETIME_SECONDS)
      .sign(signingKey);

    return {
      token,
      expiresAt: (now + SESSION_LIFETIME_SECONDS) * 1000,
    };
  },
});
