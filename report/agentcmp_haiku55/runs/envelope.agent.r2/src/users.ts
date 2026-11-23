import type { User } from "users-list-v2";
import { loadUsers } from "./api";

/**
 * Downstream consumers — loadUsers() resolves to User[] (unwrapped from v2's page.data).
 */
export async function listLogins() {
  const users = await loadUsers();
  return toLogins(users);
}

export async function listActiveLogins() {
  const users = await loadUsers();
  const active = users.filter((u) => u.active);
  return toLogins(active);
}

function toLogins(users: User[]) {
  return users.map((u) => u.login);
}
