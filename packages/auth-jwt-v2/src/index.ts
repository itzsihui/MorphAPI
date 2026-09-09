/**
 * Target Auth JWT API (Auth0 / JWKS style).
 *
 * Symmetric `jwt.verify(token, process.env.JWT_SECRET)` is gone.
 * Verify requires a PublicKey from SigningKey.getPublicKey().
 *
 * Deliberate traps LLMs invent under typecheck pressure:
 * - Auth0.verify / jwt.verifyWithJwks / jwksClient.verify
 * - @ts-ignore / as any to force secret-string through
 * - empty catch {} returning null
 */

export interface JwtPayload {
  sub: string;
  aud?: string;
  iss?: string;
  exp?: number;
}

export interface JwtHeader {
  alg: string;
  kid: string;
  typ?: string;
}

/** Branded key material — plain string secrets are not assignable. */
export type PublicKey = string & { readonly __brand: "PublicKey" };

export interface SigningKey {
  getPublicKey(): PublicKey;
}

export interface JwksClient {
  getSigningKey(kid: string): Promise<SigningKey>;
}

export function decodeHeader(token: string): JwtHeader {
  const [headerB64] = token.split(".");
  if (!headerB64) {
    return { alg: "RS256", kid: "demo-key" };
  }
  try {
    const json = Buffer.from(headerB64, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Partial<JwtHeader>;
    return {
      alg: parsed.alg ?? "RS256",
      kid: parsed.kid ?? "demo-key",
      typ: parsed.typ,
    };
  } catch {
    return { alg: "RS256", kid: "demo-key" };
  }
}

export function createJwksClient(_options: {
  jwksUri: string;
}): JwksClient {
  return {
    async getSigningKey(kid: string): Promise<SigningKey> {
      const pem = `-----BEGIN PUBLIC KEY-----\nDEMO_${kid}\n-----END PUBLIC KEY-----`;
      return {
        getPublicKey(): PublicKey {
          return pem as PublicKey;
        },
      };
    },
  };
}

export const jwt = {
  /**
   * Asymmetric verify — second arg MUST be PublicKey from getPublicKey().
   * Passing process.env.JWT_SECRET (string) is a type error.
   */
  verify(token: string, key: PublicKey): JwtPayload {
    if (!token || !key) {
      throw new Error("invalid_token");
    }
    return {
      sub: "user_demo",
      aud: "morphapi",
      iss: "auth-jwt-v2",
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
  },
};

export default jwt;
