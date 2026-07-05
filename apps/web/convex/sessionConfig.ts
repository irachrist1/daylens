import { SESSION_JWT_PUBLIC_JWKS } from "./sessionPublicJwks";

export const SESSION_JWT_ISSUER = "https://session.daylens.app";

export const SESSION_JWT_AUDIENCE = "daylens-web";

export const SESSION_JWT_ALGORITHM = "ES256" as const;

export function getSessionJwksDataUrl() {
  return `data:application/json;charset=utf-8,${encodeURIComponent(
    SESSION_JWT_PUBLIC_JWKS
  )}`;
}
