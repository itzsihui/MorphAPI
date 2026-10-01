/** @deprecated use fetchJson */
export function getJson(url: string): Promise<unknown> {
  return Promise.resolve({ url });
}
