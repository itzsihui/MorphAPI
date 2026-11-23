import { jwt, decodeHeader, createJwksClient } from "auth-jwt-v2";
import type { JwtPayload } from "auth-jwt-v2";

/**
 * Access-token helpers using JWKS-based verification (auth-jwt-v2).
 * The signing key is selected by the token's `kid` header and fetched from JWKS_URI.
 */
const jwksClient = createJwksClient({
  jwksUri: process.env.JWKS_URI!,
});

async function verifyWithJwks(token: string): Promise<JwtPayload> {
  const { kid } = decodeHeader(token);
  const signingKey = await jwksClient.getSigningKey(kid);
  return jwt.verify(token, signingKey.getPublicKey());
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  // Usage site 1 — API bearer token
  return verifyWithJwks(token);
}

export async function verifyIdToken(token: string): Promise<JwtPayload> {
  // Usage site 2 — OIDC id_token (JWKS-verified, same as access tokens)
  return verifyWithJwks(token);
}
