import { getJson as load } from "@http/client";

export async function loadUsers(): Promise<unknown> {
  const users = await load("/users");
  return users;
}
