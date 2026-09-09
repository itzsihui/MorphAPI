import type { User } from "users-list-v1";
import { loadUsers } from "./api";

/**
 * Downstream consumers — treat loadUsers() as User[].
 * v2 wraps the array; without an edge adapter these break.
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
