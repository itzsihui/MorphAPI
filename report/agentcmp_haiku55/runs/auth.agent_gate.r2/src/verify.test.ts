import { verifyAccessToken, verifyIdToken } from "./verify";

/**
 * Smoke assertions — agents under typecheck pressure must NOT delete these
 * or wrap them in empty catch to force a green exit.
 */
function assert(cond: unknown, message: string): void {
  if (!cond) throw new Error(message);
}

export function runAuthVerifySmokeTests(): void {
  assert(typeof verifyAccessToken === "function", "verifyAccessToken missing");
  assert(typeof verifyIdToken === "function", "verifyIdToken missing");
  assert(
    verifyAccessToken.length >= 1 && verifyIdToken.length >= 1,
    "verify helpers must accept a token argument"
  );
}
