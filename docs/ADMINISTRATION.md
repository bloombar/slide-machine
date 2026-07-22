# Administering Slide Machine

An operator's guide to running the app: granting admin access, using the
read-only console, changing behavior via config, managing plans and data
retention, and keeping a deployment healthy. To stand a deployment up from
scratch, see [docs/DEPLOY.md](DEPLOY.md).

## Who can administer

Admin access is an **email allowlist**, not a role on the account. The
`ADMIN_EMAILS` environment variable holds a comma-separated list of account
emails; anyone signed in with a listed email is an admin, and no one else.
There is deliberately no in-app way to grant it.

```sh
ADMIN_EMAILS=you@example.com,ops@example.com
```

The value is read on **every** request
([server/src/config/admin.ts](../server/src/config/admin.ts)), so a change
takes effect as soon as the process has it — no migration, no code deploy.
Locally, set it in `server/.env` and restart. On DO App Platform, edit it
on the `web` component (Settings → Environment Variables); saving triggers
a redeploy. Removing an email revokes access the same way.

The allowlist is the real security boundary: every `/api/admin` route is
gated by `requireAuth` + `requireAdmin`, and admin reads bypass the normal
per-object ACLs (the client menu and route guard are cosmetic). Keep the
list short — an allowlisted account can read every user's data.

## The admin console (`/app/admin`)

Read-only. It answers "who is using this and what have they made," not
"change something."

- **User directory** — every account (email, handle, join date), paginated
  (10 / 25 / 50 / 100 per page) and sortable (newest, oldest, email A–Z).
- **User drill-down** — account details (plan, email verification, locale,
  profile visibility, project/lecture counts) plus the user's projects.
  Each project expands to a table of its lectures with a **public/private
  badge**, **slide count**, and **last-edited date** (the newest edit to
  the project or any of its lectures); each lecture links to its viewer
  (`/d/:slug`). Lectures the user owns inside someone else's project are
  grouped under "Other lectures."

The console has no action to edit, suspend, or delete another user's
account or content — the router exposes only reads. Any operator-initiated
change is a **direct database operation** today (see below); use the
console to *find* the record, then act out of band.

## Changing how the app behaves

Most behavior is set by environment variables, not code — full annotated
list in [server/.env.example](../server/.env.example), production subset in
[docs/DEPLOY.md §5](DEPLOY.md#5-environment-variables). The knobs reached
for most:

| Concern | Variable(s) | Notes |
| --- | --- | --- |
| Generation model / timeout | `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS` | Default favors latency |
| How freely AI elaborates | `GENERATION_FREEDOM` (1–5) | Server default; projects/lectures can override |
| Live-session speech engine | `TRANSCRIPTION_PROVIDER` | `browser` (keyless) / `google-cloud` / `none` |
| Slide narration (TTS) | `TTS_PROVIDER`, `TTS_DEFAULT_VOICE` | No key → play / "Speak this slide" is off |
| Stock-image enrichment | `IMAGE_ENRICHMENT_ENABLED`, `IMAGE_RERANK_*` | Wikimedia/Openverse keyless; Flickr needs a key |
| Refine slider defaults | `REFINE_SLIDES_DEFAULT_LEVEL`, `REFINE_TRANSCRIPT_DEFAULT_LEVEL` | Starting strength before a lecture sets its own |

On App Platform, changing any of these triggers a redeploy that picks up
the new value.

## Plans and usage caps

Tiers and their caps live in [config/plans.json](../config/plans.json), not
the database (`PLANS_CONFIG_PATH` overrides the path). Each tier sets a
Stripe `priceId` and caps for `geminiTokens`, `sttMinutes`, `imageCalls`,
and `exports` (`null` = unlimited). Edit and redeploy to change what a plan
includes; the `priceId`s must match real Stripe prices for billing to work
(`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`). A user's `planTier` shows
read-only in the console; changing it is a database operation.

## Data retention and privacy

Retained **lecture audio** is the most sensitive data the app holds — raw
student voices. It is off by default, captured only when
`AUDIO_RETENTION_ENABLED=true` with `TRANSCRIPTION_PROVIDER=google-cloud`
(the browser engine's audio never reaches the server). When on, each
session's audio is stored as a WAV under the bucket's `audio/` prefix
(~5.7 MB/min), and a **daily sweep** deletes recordings past
`AUDIO_RETENTION_DAYS` (default 30; `0` = keep forever) with their deck
references. As a backstop, add an object-storage lifecycle rule **scoped to
`audio/`** ([docs/DEPLOY.md §2](DEPLOY.md#2-do-spaces-object-storage-for-uploads))
so it doesn't also expire slide images, narration, or seed files.

Seed material (`seed/`), slide images (`slides/`), and TTS narration
(`tts/`) share the bucket, served public-read from the CDN. Deleting a
project or lecture in the app cascades its stored files.

## Accounts and authentication

- **Password reset / email verification** are user self-service and need
  SMTP configured (`SMTP_*`); there is no admin "set this password" action.
- **Rotating auth secrets** logs users out: changing `JWT_REFRESH_SECRET`
  invalidates every refresh token (all users out on next refresh) — do it
  deliberately, e.g. a suspected leak. Rotating `JWT_SECRET` only affects
  short-lived (15 min) access tokens.
- **Google / GitHub sign-in** needs the OAuth client and a byte-for-byte
  redirect URI — see [docs/GOOGLE_SIGN_IN.md](GOOGLE_SIGN_IN.md) and
  [docs/DEPLOY.md §6](DEPLOY.md#6-register-the-google-oauth-redirect-uri).

## Health, logs, and incidents

- **Health:** `GET /api/health` aggregates each component probe. It returns
  **200 even when Mongo is down** (so a blip doesn't flap the platform
  check) — read the JSON body (`"mongo": "connected"`), not the status
  code. The footer health badge reads the same endpoint.
- **Logs:** `doctl apps logs <app-id> --type run` (`--type build` for build
  failures).
- **Backups:** Atlas automated backups exist on dedicated tiers (not free
  M0) — enable and verify them; the app keeps none of its own.

## Direct database operations

Anything the console can't do — moderating content, deleting/merging
accounts, correcting data, changing a `planTier` — is done directly against
MongoDB today. It's an escape hatch:

- Prefer the app's own cascades: deleting a **project** in-app removes its
  decks, slides, and seed files (including stored objects); a raw
  `deleteOne` orphans them.
- Snapshot (Atlas) before a bulk or destructive change.
- Collections `users`, `projects`, `decks`, `slides`, `seedassets` map to
  [server/src/models/](../server/src/models/); find ids via the console
  first.

If a class of action becomes routine (bulk moderation, account deletion),
that's the signal to add a real mutation endpoint behind `requireAdmin`
with an audit trail rather than growing a habit of hand edits.
