import createUsersApi from "users-list-v2";

/**
 * Network edge — returns the user array from listUsers().
 * v2 wraps the array in a page object; we unwrap `data` so consumers
 * in users.ts keep receiving a plain User[] as they did with v1.
 */
export async function loadUsers() {
  const api = createUsersApi(process.env.USERS_API_KEY ?? "demo");
  const page = await api.listUsers();
  return page.data;
}
