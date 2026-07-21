# Admin interface

A read-only admin surface: a paginated, sortable directory of every
account (email, handle, time of joining), and a per-user drill-down
showing account details and the user's projects, each expandable to its
lectures with links to the live deck viewer (`/d/:slug`) and the user's
public profile (`/u/:id`).

## Status: built, not yet wired in

Everything ships in **new files only**; no existing route, model, DTO, or
page changed. The five one-hunk edits that switch the feature on live in
[admin-wiring.patch](./admin-wiring.patch) (131 added lines, nothing
removed). Until it is applied, the admin code is dormant: the API router
is never mounted and the pages are unreachable.

```sh
git apply docs/admin-wiring.patch
```

The patch touches:

| File | Change |
| --- | --- |
| `server/src/app.ts` | mount `adminRouter` at `/api/admin` |
| `client/src/App.tsx` | `/app/admin` + `/app/admin/users/:userId` routes behind `RequireAdmin` |
| `client/src/components/layout/ShellMenu.tsx` | "Admin" menu item, rendered only for admins |
| `server/.env.example` | document `ADMIN_EMAILS` |
| `e2e/playwright.config.ts` | `ADMIN_EMAILS` for the e2e server |
| `e2e/tests/admin.spec.ts` | new e2e spec (admin journey + non-admin lockout) |

The whole wired state was validated before being captured as a patch:
all three workspaces typecheck, the client suite passes, and the e2e
spec passes against the built app.

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
- E2E (after applying the wiring patch and `npm run build`):
  `npx playwright test tests/admin.spec.ts` from `e2e/`.

## Follow-ups once the wiring lands

- Move the admin wire types (duplicated between
  `server/src/routes/admin.ts` and `client/src/api/admin.ts`) into the
  `shared` workspace.
- Fold `ADMIN_EMAILS` into the zod schema in `server/src/config/env.ts`.
- Add a ShellMenu unit test covering the conditional Admin item
  (ShellMenu.test.tsx predates this feature and was left untouched).
