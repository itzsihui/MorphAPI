import { jwt, decodeHeader, createJwksClient, JwtPayload } from "auth-jwt-v2";

const jwksClient = createJwksClient({
  jwksUri: process.env.JWKS_URI!,
});

/**
 * Verify a token using the signing key published in the JWKS for its `kid`.
 * Replaces the legacy symmetric-secret verify (removed in auth-jwt-v2).
 */
async function verifyWithJwks(token: string): Promise<JwtPayload> {
  const { kid } = decodeHeader(token);
  const signingKey = await jwksClient.getSigningKey(kid);
  return jwt.verify(token, signingKey.getPublicKey());
}

/**
 * Access-token helpers (API bearer tokens), verified via JWKS.
 */
export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  // Usage site 1 — API bearer token
  return verifyWithJwks(token);
}

/**
 * OIDC id_token helpers, verified via JWKS.
 */
export async function verifyIdToken(token: string): Promise<JwtPayload> {
  // Usage site 2 — OIDC id_token (previously the same secret path)
  return verifyWithJwks(token);
}
