/**
 * Legacy Auth JWT client: jwt.verify(token, secret) with a shared HS256 secret.
 * v2 removes secret-string verify — callers must use JWKS + PublicKey.
 */

export interface JwtPayload {
  sub: string;
  aud?: string;
  iss?: string;
  exp?: number;
}

export interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

export function decodeHeader(token: string): JwtHeader {
  const [headerB64] = token.split(".");
  if (!headerB64) return { alg: "HS256" };
  try {
    const json = Buffer.from(headerB64, "base64url").toString("utf8");
    return JSON.parse(json) as JwtHeader;
  } catch {
    return { alg: "HS256", kid: "legacy" };
  }
}

export const jwt = {
  /**
   * Symmetric verify — accepted in v1, rejected by types in auth-jwt-v2.
   */
  verify(token: string, secret: string): JwtPayload {
    if (!token || !secret) {
      throw new Error("invalid_token");
    }
    const header = decodeHeader(token);
    return {
      sub: "user_demo",
      aud: "morphapi",
      iss: "auth-jwt-v1",
      exp: Math.floor(Date.now() / 1000) + 3600,
      // expose header kid for migration demos
      ...(header.kid ? { kid: header.kid } : {}),
    } as JwtPayload;
  },
};

export default jwt;
