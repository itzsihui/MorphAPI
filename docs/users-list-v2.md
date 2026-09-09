# Users List Migration Guide (v1 → v2)

Legacy `listUsers()` returned a bare array. v2 adds pagination metadata.

## Overview

The method name is unchanged: `api.listUsers()`.
Update package imports to `users-list-v2`.

## Typical pattern

```ts
import createUsersApi from "users-list-v2";

const api = createUsersApi(process.env.USERS_API_KEY!);
const page = await api.listUsers();
if (page.pagination.hasMore) {
  // fetch next page with page.pagination.cursor
}
```

## Notes

- Keep calling `listUsers()` — no rename.
- Prefer reading `pagination` when implementing infinite scroll.
- Example above focuses on cursor fields used by the new UI.
- See provider docs for rate limits on list endpoints.
