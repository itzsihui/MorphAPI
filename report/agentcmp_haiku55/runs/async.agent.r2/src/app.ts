import { fetchObjectBody } from "./io";

/**
 * Mid/upper call stack. fetchObjectBody is asynchronous (it performs an S3
 * read), so loadSettings and bootApp are async and await the result before
 * parsing. Previously the Promise itself was passed to JSON.parse, which
 * could never succeed at runtime.
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
