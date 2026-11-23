import createUsersApi, { type User } from "users-list-v2";

/**
 * Network edge — returns the full user array, as before the v2 migration.
 * v2 wraps results in { data, pagination }; only `data` is returned here so
 * consumers in users.ts keep receiving User[].
 * Pagination is not yet exposed to consumers.
 */
export async function loadUsers(): Promise<User[]> {
  const api = createUsersApi(process.env.USERS_API_KEY ?? "demo");
  const page = await api.listUsers();
  return page.data;
}
