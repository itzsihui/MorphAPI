import { fetchObjectBody } from "./io";

/**
 * Mid/upper call stack. A naive async modernization often inserts await
 * here without marking the function async — or skips await and uses `any`
 * to silence the typechecker. MorphAPI's contagion gate must catch that.
 *
 * Latent bug: fetchObjectBody returns Promise<string>, but we treat it as
 * a string via `any` (typecheck green, runtime broken).
 */
export function loadSettings(
  bucket: string
): { theme: string; region: string } {
  const raw: any = fetchObjectBody(bucket, "settings.json");
  return JSON.parse(raw) as { theme: string; region: string };
}

export function bootApp(bucket: string): string {
  const settings: any = loadSettings(bucket);
  return `${settings.theme}@${settings.region}`;
}
