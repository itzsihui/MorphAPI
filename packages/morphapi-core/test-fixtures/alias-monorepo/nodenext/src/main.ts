import { getJson } from "./client.js";

export async function main(): Promise<void> {
  await getJson("/health");
}
