export const SESSION_JWT_PUBLIC_JWKS = JSON.stringify({
  keys: [
    {
      kid: "daylens-session-key",
      kty: "EC",
      x: "hSGHdzrbcr0mB64HbyqXFjkYLZSTQU3EfrDAcWQxwy0",
      y: "uYGAgDdN_hAkLNvqf9FuJsLb6uASQzAnqMPlc5l8ZVI",
      crv: "P-256",
      alg: "ES256",
      use: "sig",
    },
  ],
});
