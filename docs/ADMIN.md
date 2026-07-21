# Admin interface

A read-only admin surface: a paginated, sortable directory of every
account (email, handle, time of joining), and a per-user drill-down
showing account details and the user's projects, each expandable to its
lectures with links to the live deck viewer (`/d/:slug`) and the user's
public profile (`/u/:id`).

## Status: wired in

The feature is live. The wiring lives in these files:

| File | Role |
| --- | --- |
| `server/src/app.ts` | mounts `adminRouter` at `/api/admin` |
| `client/src/App.tsx` | `/app/admin` + `/app/admin/users/:userId` routes behind `RequireAdmin` |
| `client/src/components/layout/ShellMenu.tsx` | "Admin" menu item, rendered only for admins |
| `server/.env.example` | documents `ADMIN_EMAILS` |
| `e2e/playwright.config.ts` | `ADMIN_EMAILS` for the e2e server |
| `e2e/tests/admin.spec.ts` | e2e spec (admin journey + non-admin lockout) |

Everything else ships in new files; no existing model or DTO changed.

To use it locally, set `ADMIN_EMAILS` in `server/.env` (see below) and
restart the server — the Admin item then appears in the shell menu.

## Who is an admin

Admin status comes from the `ADMIN_EMAILS` environment variable — a
comma-separated list of account emails:

```sh
ADMIN_EMAILS=you@example.com,colleague@example.com
```

There is deliberately no `role` field on the User model and no API that
grants adminship. The variable is read at request time
(`server/src/config/admin.ts`), so changing it only requires a server
restart, not a migration.

## Security model

`server/src/routes/admin.ts` guards itself with
`requireAuth` + `requireAdmin` (`server/src/middleware/admin.ts`):
a missing token is 401, any non-allowlisted account is 403. That
middleware is the enforcement; everything client-side (`RequireAdmin`,
the menu item) is cosmetic. Admin reads intentionally bypass the
`lib/access.ts` ACLs — the allowlist gate is the authorization.

## API

All routes sit under `/api/admin` and are read-only:

- `GET /status` — `{ isAdmin: true }`; the client's `useIsAdmin` hook
  uses it (cached per account, fetched at most once per session, and
  only when an admin surface or the open menu needs it).
- `GET /users?page=&limit=&sort=` — paginated directory
  (`sort`: `newest` | `oldest` | `email`).
- `GET /users/:id` — full `SafeUser` DTO plus project/lecture counts.
- `GET /users/:id/projects` — the user's projects.
- `GET /users/:id/decks?projectId=` — the user's lectures (with
  `permalinkSlug` for viewer links), optionally filtered by project.

## Tests

- Unit: `server/src/config/admin.test.ts`,
  `server/src/middleware/admin.test.ts`, plus client tests for both
  pages and the `RequireAdmin` guard.
- Integration (needs the test MongoDB):
  `npm run test:integration -w server -- test/integration/admin.test.ts`
- E2E (after `npm run build`):
  `npx playwright test tests/admin.spec.ts` from `e2e/`.

## Follow-ups

- Move the admin wire types (duplicated between
  `server/src/routes/admin.ts` and `client/src/api/admin.ts`) into the
  `shared` workspace.
- Fold `ADMIN_EMAILS` into the zod schema in `server/src/config/env.ts`.
- Add a ShellMenu unit test covering the conditional Admin item
  (ShellMenu.test.tsx predates this feature and was left untouched).
