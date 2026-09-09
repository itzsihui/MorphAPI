/**
 * Users list API v2 — SAME method name, but response is wrapped:
 *   { data: User[]; pagination: { cursor: string | null; hasMore: boolean } }
 *
 * Updating only the call site / import and leaving downstream `.map` /
 * helpers that expect User[] is the classic DFG-blindness failure.
 */

export interface User {
  id: string;
  login: string;
  active: boolean;
}

export interface Pagination {
  cursor: string | null;
  hasMore: boolean;
}

export interface UsersPage {
  data: User[];
  pagination: Pagination;
}

export interface UsersListClient {
  listUsers(): Promise<UsersPage>;
}

export function createUsersApi(apiKey: string): UsersListClient {
  if (!apiKey) {
    throw new Error("users-list-v2 requires an apiKey");
  }
  return {
    async listUsers(): Promise<UsersPage> {
      return {
        data: [
          { id: "1", login: "alice", active: true },
          { id: "2", login: "bob", active: false },
        ],
        pagination: { cursor: null, hasMore: false },
      };
    },
  };
}

export default createUsersApi;
