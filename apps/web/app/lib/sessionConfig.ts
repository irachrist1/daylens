import { importJWK, jwtVerify } from "jose";

export const SESSION_COOKIE = "daylens_session";
export const SESSION_JWT_ISSUER = "https://session.daylens.app";
export const SESSION_JWT_AUDIENCE = "daylens-web";

export const SESSION_PUBLIC_JWK = {
  kid: "daylens-session-key",
  kty: "EC" as const,
  x: "hSGHdzrbcr0mB64HbyqXFjkYLZSTQU3EfrDAcWQxwy0",
  y: "uYGAgDdN_hAkLNvqf9FuJsLb6uASQzAnqMPlc5l8ZVI",
  crv: "P-256" as const,
  alg: "ES256",
  use: "sig",
};

let cachedKey: CryptoKey | null = null;

export async function getSessionPublicKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    cachedKey = (await importJWK(SESSION_PUBLIC_JWK, "ES256")) as CryptoKey;
  }
  return cachedKey;
}

export async function verifySessionToken(token: string) {
  const publicKey = await getSessionPublicKey();
  return jwtVerify(token, publicKey, {
    algorithms: ["ES256"],
    issuer: SESSION_JWT_ISSUER,
    audience: SESSION_JWT_AUDIENCE,
  });
}
