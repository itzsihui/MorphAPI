/**
 * Users list API v1 — listUsers() returns a flat User[].
 * Migrating to v2 wraps the array in { data, pagination }.
 */

export interface User {
  id: string;
  login: string;
  active: boolean;
}

export interface UsersListClient {
  listUsers(): Promise<User[]>;
}

export function createUsersApi(apiKey: string): UsersListClient {
  if (!apiKey) {
    throw new Error("users-list-v1 requires an apiKey");
  }
  return {
    async listUsers(): Promise<User[]> {
      return [
        { id: "1", login: "alice", active: true },
        { id: "2", login: "bob", active: false },
      ];
    },
  };
}

export default createUsersApi;
