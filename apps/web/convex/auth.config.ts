import type { AuthConfig } from "convex/server";
import {
  getSessionJwksDataUrl,
  SESSION_JWT_ALGORITHM,
  SESSION_JWT_AUDIENCE,
  SESSION_JWT_ISSUER,
} from "./sessionConfig";

export default {
  providers: [
    {
      type: "customJwt",
      applicationID: SESSION_JWT_AUDIENCE,
      issuer: SESSION_JWT_ISSUER,
      jwks: getSessionJwksDataUrl(),
      algorithm: SESSION_JWT_ALGORITHM,
    },
  ],
} satisfies AuthConfig;
