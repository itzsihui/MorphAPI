import * as http from "./client";

export async function main(): Promise<void> {
  await http.getJson("/health");
}
