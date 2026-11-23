import {
  jwt,
  decodeHeader,
  createJwksClient,
  type JwtPayload,
} from "auth-jwt-v2";

/**
 * Access-token helpers using JWKS-based verification (auth-jwt-v2).
 * The legacy symmetric JWT_SECRET verify has been removed; keys are fetched
 * from JWKS_URI by the token's kid.
 */
const jwksClient = createJwksClient({
  jwksUri: process.env.JWKS_URI!,
});

async function verifyWithJwks(token: string): Promise<JwtPayload> {
  if (!token) {
    throw new Error("invalid_token");
  }
  const { kid } = decodeHeader(token);
  const signingKey = await jwksClient.getSigningKey(kid);
  return jwt.verify(token, signingKey.getPublicKey());
}

/**
 * Usage site 1 — API bearer token.
 */
export function verifyAccessToken(token: string): Promise<JwtPayload> {
  return verifyWithJwks(token);
}

/**
 * Usage site 2 — OIDC id_token (previously the same secret path).
 */
export function verifyIdToken(token: string): Promise<JwtPayload> {
  return verifyWithJwks(token);
}
