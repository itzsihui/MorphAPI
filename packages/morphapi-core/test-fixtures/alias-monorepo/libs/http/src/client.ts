/** @deprecated use fetchJson */
export function getJson(url: string): Promise<unknown> {
  return Promise.resolve({ url });
}

export async function fetchJson<T>(url: string, init?: { timeoutMs?: number }): Promise<T> {
  return { url, init } as unknown as T;
}
