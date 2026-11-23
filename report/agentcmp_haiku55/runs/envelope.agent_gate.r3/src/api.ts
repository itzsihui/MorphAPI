import createUsersApi, { type User } from "users-list-v2";

/**
 * Network edge — returns the user array from listUsers().
 * v2 wraps the array in `{ data, pagination }`; we unwrap `data` so
 * consumers in users.ts keep receiving a plain User[] as before.
 * Consumers live in users.ts (not shown to LLM-only).
 */
export async function loadUsers(): Promise<User[]> {
  const api = createUsersApi(process.env.USERS_API_KEY ?? "demo");
  const page = await api.listUsers();
  return page.data;
}
