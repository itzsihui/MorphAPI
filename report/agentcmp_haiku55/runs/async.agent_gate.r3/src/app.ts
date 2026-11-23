import { fetchObjectBody } from "./io";

/**
 * Mid/upper call stack. fetchObjectBody returns Promise<string>, so callers
 * must be async and await it; the result is then parsed as settings JSON.
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
