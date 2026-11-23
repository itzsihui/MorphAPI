import { jwt, decodeHeader, createJwksClient, JwksClient, JwtPayload } from "auth-jwt-v2";

/**
 * Access-token helpers using JWKS-based verification (auth-jwt-v2).
 * The legacy symmetric JWT_SECRET path has been removed in v2.
 */
let jwksClient: JwksClient | undefined;

function getJwksClient(): JwksClient {
  const jwksUri = process.env.JWKS_URI;
  // Fail closed when no key source is configured (mirrors the legacy missing-secret error).
  if (!jwksUri) {
    throw new Error("invalid_token");
  }
  if (!jwksClient) {
    jwksClient = createJwksClient({ jwksUri });
  }
  return jwksClient;
}

async function verifyWithJwks(token: string): Promise<JwtPayload> {
  const client = getJwksClient();
  // 1) Read kid from the token header
  const { kid } = decodeHeader(token);
  // 2) Fetch the signing key for that kid
  const signingKey = await client.getSigningKey(kid);
  // 3) Verify with the key's public material
  return jwt.verify(token, signingKey.getPublicKey());
}

export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  // Usage site 1 — API bearer token
  return verifyWithJwks(token);
}

export async function verifyIdToken(token: string): Promise<JwtPayload> {
  // Usage site 2 — OIDC id_token (same JWKS path)
  return verifyWithJwks(token);
}
