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

It answers "who is using this and what have they made," and carries the
moderation actions for when the answer calls for one.

- **User directory** — every account (email, handle, join date), paginated
  (10 / 25 / 50 / 100 per page) and sortable (newest, oldest, email A–Z).
- **Project directory** (`/app/admin/projects`) — every project on the
  platform (title, owner, visibility, lecture count, timestamps),
  paginated and sortable (title, created, updated; last-edited first by
  default). Rows link to the project page, owners to their user page.
- **Lecture directory** (`/app/admin/decks`) — every lecture on the
  platform (title, project, owner, effective visibility, slide count,
  timestamps), paginated and sortable the same way. Rows link to the
  lecture page, and the project and owner cells to theirs.
- **User drill-down** — account details (plan, email verification, locale,
  profile visibility, project/lecture counts) plus the user's projects,
  each linking to its own **project page**. Lectures the user owns inside
  someone else's project are grouped under "Other lectures." Carries a
  **Settings** section for the account's profile fields.
- **Project page** — the project's owner and a table of its lectures with
  a **public/private badge**, **slide count**, and **last-edited date**;
  each lecture links to its own **lecture page**. Carries the same
  private-lecture toggle and delete actions as the user page, plus a
  **View project** button into the product view, where its settings are
  edited.
- **Lecture page** — the lecture's project and owner, its details, a
  **View slideshow** link to the live viewer (`/d/:slug`) where its
  settings are edited, and the delete action. Opens for any lecture
  regardless of the private-lecture toggle, mirroring the always-on
  viewer access.
- **Logs** (`/app/admin/logs`) — the admin audit log: what admins did.
- **Settings changes** (`/app/admin/settings-logs`) — the settings change
  log: how any account's, project's, or lecture's settings got this way,
  whoever changed them.

### Moderation

The user drill-down carries the mutation surface; every action asks for
confirmation, is recorded in the audit log, and — except the password
reset and the ban — cannot be undone from the app:

- **Delete a project / lecture** — per-row Delete buttons. Cascades
  through everything underneath: lectures, slides, seed material and its
  stored files, transcripts, refine jobs, and retained recordings.
- **Reset password** (danger zone) — sets a new password (min 8 chars)
  and signs the user out everywhere. Tell the user their new password out
  of band; the app does not email it.
- **Ban email** (danger zone) — the email can no longer sign in (password
  or Google) or register, and every session ends now. Content stays until
  deleted separately; the account row shows a **Banned** badge and the
  button becomes **Unban email**, which lifts the ban (also confirmed
  and audited) so the account can sign in again.
- **Delete user** (danger zone) — deletes the account and all of its
  data: their projects (and everything in them), lectures they own inside
  other users' projects, their id in other users' sharing lists, and all
  sessions. The audit log keeps its entries about them.

Admin accounts moderate; they are not moderated: any of these against an
allowlisted email (including your own) is refused with `target_is_admin`
until the email is removed from `ADMIN_EMAILS`. The settings editing below
extends that to **content**: editing a project or lecture whose *owner* is
allowlisted is refused the same way.

### Editing settings

**Account settings** are edited in the console. The user page carries a
**Settings** section for the account's profile fields; nothing is sent
while you type — the form holds a draft, **Save changes** stays disabled
until something differs, and confirming shows the exact `old → new` of
every field before one request goes out.

**Project and lecture settings are edited in the product itself**, in the
same settings modal their owner uses: open the project (**View project**)
or the lecture (**View slideshow**) from its console page and use the
settings icon. Because the entity is not yours, the first click asks for
confirmation, a banner stays up while the settings are open, and the
server records every change you make. Nothing about the controls changes
— they save as you go, exactly as they do for the owner.

| Entity | Editable | Where | Not editable |
| --- | --- | --- | --- |
| User | Display name, bio, profile visibility, interface locale, lecturing language | Admin console | Plan tier (see Plans below), email, password (its own danger-zone action), email verification |
| Project | Title, seed notes, AI freedom, language, narration voice, template, visibility and the sharing list | Project settings modal | Seed material, ownership, deletion (a console action) |
| Lecture | Title, seed notes, AI freedom, language, narration voice, template, the five Refine settings, visibility and the sharing list | Lecture settings modal | Seed material, running a refine, quizzes, exports, slides, ownership, deletion (a console action) |

What an admin does *not* get in those modals is everything that is not a
settings edit: uploading seed material, running a refine over the owner's
slides, and the Quiz and Export tabs, which act through the admin's own
Google account. Slides stay read-only throughout ([ADMIN-3]).

Two things to know before editing:

- **Unset means inherited.** Every generation setting can be handed back
  to the level above it ("Default" / "Reset to default"), which stores
  nothing at this level rather than storing a copy.
- **A lecture's visibility is one-way.** A lecture normally follows its
  project; choosing *any* visibility on it — even the one it already
  inherits — copies the project's current people lists onto the lecture
  and stops it following the project. **"Use project settings"** undoes
  that. The audit entry spells it out as an `accessInherited` change.

[ADMIN-3]: SPEC.md#admin-3-viewing-user-content--seed-material

### Private lectures

An allowlisted admin can **always open any lecture in the viewer**
(`/d/:slug`), private or not — like the admin API, the allowlist is the
authorization. The content is read-only there; only its settings are
editable, as above. The admin console lists **every
lecture, private or not**, on the same basis: the site-wide lecture
directory and the lecture tables on a user's admin page and on the admin
project pages always include private lectures, with no toggle.
Individual viewer opens are not logged.

Opening a private *project* in the product view is a separate step: the
**"View project"** button on an admin project page confirms first and
records the access in the audit log (`project.private_view`).

### Audit log (`/app/admin/logs`)

The audit log records admin actions that change or expose user data. Each
entry holds the acting admin (id + email snapshot), a namespaced action
name (`user.delete`, `deck.delete`, …), an optional target (type + id),
optional action-specific details, and a timestamp. The page lists entries
newest first, paginated, with a **Download CSV** button that exports the
whole log.

Both the acting admin and the target link to their admin detail pages, so
an entry is one click from the record it describes. The target shows its
kind plus the name snapshotted at the time (the user's email, the project
or lecture title). Deletions are the exception: the record is gone, so
the name is struck through rather than linked.

Entries are **append-only**: they are written through one server module
([server/src/audit/log.ts](../server/src/audit/log.ts)) into the
`adminactionlogs` Mongo collection, and no API can edit or delete them.
Every moderation action writes one (`user.delete`, `user.ban_email`,
`user.unban_email`, `user.password_reset`, `project.delete`,
`deck.delete`), as does opening a private project in the product view
(`project.private_view`). Every settings edit writes one too
(`user.settings_update` from the console; `project.settings_update` and
`deck.settings_update` from the product's own settings modals), whose
details carry a `changes` object holding each edited field's `from` and
`to` — an edit that changes nothing saves nothing and writes no entry.
An owner or editor changing their own settings writes nothing here; only
the admin override is logged, and the [settings change
log](#settings-change-log-appadminsettings-logs) covers the rest. It is
the durable audit trail; a local CSV would not survive an App Platform
redeploy, which is why the CSV is an on-demand export rather than the
store.

### Settings change log (`/app/admin/settings-logs`)

A second, separate log. The audit log answers "what have admins done";
this one answers "how did these settings get this way" — **every**
settings change on the platform, whoever made it. A user switching their
profile to private, a colleague with edit access changing a project's
language, an admin editing an account from the console: all three land
here. An admin's settings edit is therefore in both logs.

Each entry holds the acting user (id + email snapshot), the **role** they
acted in (`owner`, `editor`, or `admin`), which record changed (kind, id,
and the name snapshotted at the time), the **owner** those settings belong
to, the changed fields as `{field: {from, to}}`, and a timestamp. Cleared
settings record as `null` and read as "not set" on the page; a long value
is truncated so one big bio cannot bloat the log.

The page lists entries newest first, paginated, filterable by kind
(accounts / projects / lectures), with a **Download CSV** button that
exports whatever the filter is showing. The API also filters by
`entityId` (one record's whole history) and `ownerId` (everything one
account owns).

What counts as a "setting" is defined in one place —
[server/src/lib/settings-snapshot.ts](../server/src/lib/settings-snapshot.ts)
— and read by both logs, so adding a field to a settings editor means
adding it there. Writes go through
[server/src/audit/settings-log.ts](../server/src/audit/settings-log.ts)
into the `settingschangelogs` collection; like the audit log it is
**append-only**, and no API can edit or delete an entry. Content edits
(slides, recordings, refine runs) are not settings and are not recorded,
and an edit that changes nothing writes no entry — which is why merely
opening a sharing tab, which reads through the same code path as an edit,
leaves no trace.

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
read-only in the console: the settings editor excludes it by design —
billing state is governed by [SPEC §5](SPEC.md#5-plans-billing--usage-limits),
not by moderation — so changing it is a database operation.

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
  SMTP configured (`SMTP_*`). An admin can also set a user's password from
  the console's danger zone (see Moderation above); it signs the user out
  everywhere and is recorded in the audit log.
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

Anything the console can't do — merging accounts, correcting data,
changing a `planTier` — is done directly against MongoDB. It's an
escape hatch:

- Prefer the console's own actions where they exist (delete user /
  project / lecture, ban, password reset): they cascade through stored
  files and land in the audit log; a raw `deleteOne` orphans data and
  leaves no trace.
- Snapshot (Atlas) before a bulk or destructive change.
- Collections `users`, `projects`, `decks`, `slides`, `seedassets`,
  `bannedemails` map to
  [server/src/models/](../server/src/models/); find ids via the console
  first.

If a class of action becomes routine, that's the signal to add a real
mutation endpoint behind `requireAdmin` rather than growing a habit of
hand edits. Every admin mutation endpoint must record itself by calling
`logAdminAction`
([server/src/audit/log.ts](../server/src/audit/log.ts)), which feeds the
console's audit log page — the existing moderation endpoints in
[server/src/routes/admin.ts](../server/src/routes/admin.ts) are the
pattern to copy. Hand edits made directly against MongoDB bypass the log
— one more reason to prefer real endpoints.
