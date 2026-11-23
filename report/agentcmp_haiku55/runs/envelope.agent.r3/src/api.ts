import createUsersApi, { type User } from "users-list-v2";

/**
 * Network edge — returns the user array from listUsers().
 * v2 wraps the array in `{ data, pagination }`; only `data` is returned here so
 * consumers in users.ts keep receiving User[] as they did with v1.
 */
export async function loadUsers(): Promise<User[]> {
  const api = createUsersApi(process.env.USERS_API_KEY ?? "demo");
  const page = await api.listUsers();
  return page.data;
}
