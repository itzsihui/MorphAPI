import { jwt, decodeHeader, createJwksClient } from "auth-jwt-v2";
import type { PublicKey } from "auth-jwt-v2";

/**
 * Access-token helpers using JWKS-based verification (auth-jwt-v2).
 * The signing key is resolved from the token's `kid` header, so verification
 * is asynchronous.
 */
const jwksClient = createJwksClient({
  jwksUri: process.env.JWKS_URI!,
});

async function resolvePublicKey(token: string): Promise<PublicKey> {
  // 1) Read kid from the token header
  const { kid } = decodeHeader(token);
  // 2) Await the signing key for that kid
  const signingKey = await jwksClient.getSigningKey(kid);
  // 3) Use the key's public material for verification
  return signingKey.getPublicKey();
}

/**
 * Verify an API bearer token.
 */
export async function verifyAccessToken(token: string) {
  // Usage site 1 — API bearer token
  return jwt.verify(token, await resolvePublicKey(token));
}

/**
 * Verify an OIDC id_token.
 */
export async function verifyIdToken(token: string) {
  // Usage site 2 — OIDC id_token (same verification path as access tokens)
  return jwt.verify(token, await resolvePublicKey(token));
}
