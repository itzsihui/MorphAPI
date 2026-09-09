import { jwt } from "auth-jwt-v1";

/**
 * Access-token helpers using legacy symmetric secret verify.
 * Migrate to auth-jwt-v2 JWKS (createJwksClient + getSigningKey + PublicKey).
 */
export function verifyAccessToken(token: string) {
  // Usage site 1 — API bearer token
  return jwt.verify(token, process.env.JWT_SECRET!);
}

export function verifyIdToken(token: string) {
  // Usage site 2 — OIDC id_token (same secret path in the legacy app)
  return jwt.verify(token, process.env.JWT_SECRET!);
}
