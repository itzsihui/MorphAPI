import { fetchObjectBody } from "./io";

/**
 * Mid/upper call stack. fetchObjectBody is async, so loadSettings and
 * bootApp must be async and await the result before parsing it.
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
