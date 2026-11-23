import { fetchObjectBody } from "./io";

/**
 * Mid/upper call stack. fetchObjectBody is async, so loadSettings and
 * bootApp are async too and await each level. (Previously the Promise was
 * passed straight to JSON.parse, which compiled loosely but threw at runtime.)
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
