import { fetchObjectBody } from "./io";

/**
 * Mid/upper call stack. fetchObjectBody is async, so this function is async
 * too and awaits the body before parsing it. (The previous version treated
 * the returned Promise as a string via `any`, so JSON.parse received
 * "[object Promise]" at runtime.)
 */
export async function loadSettings(
  bucket: string
): Promise<{ theme: string; region: string }> {
  const raw = await fetchObjectBody(bucket, "settings.json");
  return JSON.parse(raw) as { theme: string; region: string };
}

export async function bootApp(bucket: string): Promise<string> {
  const settings = await loadSettings(bucket);
  return `${settings.theme}@${settings.region}`;
}
