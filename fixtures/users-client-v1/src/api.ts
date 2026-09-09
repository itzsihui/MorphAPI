import createUsersApi from "users-list-v1";

/**
 * Network edge — returns whatever listUsers() returns.
 * Consumers live in users.ts (not shown to LLM-only).
 */
export async function loadUsers() {
  const api = createUsersApi(process.env.USERS_API_KEY ?? "demo");
  return await api.listUsers();
}
