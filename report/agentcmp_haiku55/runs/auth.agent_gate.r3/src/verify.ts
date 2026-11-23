import { jwt, decodeHeader, createJwksClient, type JwtPayload } from "auth-jwt-v2";

/**
 * Access-token helpers verifying against the identity provider's JWKS.
 * Legacy symmetric-secret verification (JWT_SECRET) has been removed.
 */
async function verifyWithJwks(token: string): Promise<JwtPayload> {
  const jwksUri = process.env.JWKS_URI;
  if (!token || !jwksUri) {
    // Same failure mode as the legacy verify for missing token/config.
    throw new Error("invalid_token");
  }

  // 1) Read kid from the token header
  const { kid } = decodeHeader(token);

  // 2) Await the signing key for that kid
  const jwksClient = createJwksClient({ jwksUri });
  const signingKey = await jwksClient.getSigningKey(kid);

  // 3) Verify with the key's public material
  return jwt.verify(token, signingKey.getPublicKey());
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  // Usage site 1 — API bearer token
  return verifyWithJwks(token);
}

export async function verifyIdToken(token: string): Promise<JwtPayload> {
  // Usage site 2 — OIDC id_token (previously the same secret path)
  return verifyWithJwks(token);
}
