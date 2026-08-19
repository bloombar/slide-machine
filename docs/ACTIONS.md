# The action layer

Every operation that modifies a project, deck, or slide — and most reads — is a
**named action**: a small object with an input schema, a declared access rule,
and an `execute` function, registered in one server-side registry and run
through one pipeline. This is [TECH-13](SPEC.md#tech-13-application-actioncommand-layer)
(the layer) and [TECH-14](SPEC.md#tech-14-declarative-action-authorization)
(declared authorization); this page is the map of how it works in the code and
how to add to it. The design record for exposing the layer to AI assistants is
[MCP.md](MCP.md).

> **Status.** Built and in use — the React UI reaches the server almost entirely
> through this layer. The machine-readable catalog TECH-13 describes
> (descriptions + JSON Schema derivation for AI channels) is future work; see
> [MCP.md §3](MCP.md#3-the-shared-substrate).

## 1. The map

| Piece | Where |
| --- | --- |
| The `Action` shape and `defineAction` | [actions/define.ts](../server/src/actions/define.ts) |
| Registry + dispatch pipeline + typed errors | [actions/dispatch.ts](../server/src/actions/dispatch.ts) |
| Per-request context (`userId`, `requestId`, `origin`) | [actions/context.ts](../server/src/actions/context.ts) |
| Access-policy vocabulary and constructors | [actions/access/](../server/src/actions/access/) — start at [policy.ts](../server/src/actions/access/policy.ts) |
| The one import list that populates the registry | [actions/register-all.ts](../server/src/actions/register-all.ts) |
| The authoritative index of every action's guard | `ACCESS_INDEX` in [actions/access-registry.test.ts](../server/src/actions/access-registry.test.ts) |
| HTTP entry point (`POST /api/actions/:name`) | [routes/actions.ts](../server/src/routes/actions.ts) |
| Client caller | `dispatchAction` in [client/src/api/actions.ts](../client/src/api/actions.ts) |

Action definitions live one file per family in
[server/src/actions/](../server/src/actions/): `deck.*` (lectures), `project.*`,
`slide.*`, `template.*`, `user.*`, `quiz.*`, `billing.*`, `export.*`,
`seedAsset.*`, `social.*`, `drive.*`, `session.*`, `system.*`. Names are dotted
`family.verb` — `slide.editContent`, `deck.switchTemplate`. There is no
hand-maintained list of them anywhere: the registry is the index, and the
`ACCESS_INDEX` table in the audit test is its one reviewable, always-current
rendering (a stale row fails CI).

## 2. The pipeline

`dispatch(name, rawInput, ctx)` runs every action through the same four steps:

1. **Validate** — the input is untrusted and parsed with the action's Zod
   schema; failure throws `ActionValidationError` (→ 400).
2. **Authorize** — the declared access policy runs. It refuses
   (`ActionForbiddenError` → 403) or returns the documents it loaded to decide,
   which are handed to `execute` so nothing is fetched twice. Authorization
   runs **before** metering, deliberately: a caller with no rights to a
   resource is refused without learning anything about their plan.
3. **Meter** — the optional per-action plan-cap hook
   ([BILL-3](SPEC.md#bill-3-usage-caps--metering)).
4. **Execute** — wrapped in `runWithUsage`, so every cost the action incurs —
   including provider calls several layers down — is attributed to the acting
   user and, via `entityFromInput`, to the lecture/project named in the input
   ([BILL-7](SPEC.md#bill-7-cost-attribution--admin-cost-reporting)). Attribution is resolved in the
   dispatcher, once, not per action.

Two errors are deliberately **not** plain forbidden, because the user can fix
them and the client renders a remedy instead of a refusal:
`EmailUnverifiedError` (confirm your address —
[AUTH-3](SPEC.md#auth-3-email-verification)) and `CapabilityRequiredError`
(connect a Google account — [EXP-4](SPEC.md#exp-4-connected-accounts-google-drive)).
The error middleware maps all of these to statuses uniformly; no route does its
own mapping.

Trusted in-process callers (seeding, background work) use `runAction`, which
takes the action by typed reference instead of by name and may opt out of
metering. The HTTP path never may.

## 3. Registration and the index

Actions self-register at module load (`registerAction` in each family file);
[register-all.ts](../server/src/actions/register-all.ts) is the single import
list that makes the registry whole. Both the server and the audit test import
it — a family file added there is registered everywhere at once; added anywhere
else, it is invisible to the audit, which is the failure mode to avoid.
`listActions()` exposes the populated registry.

## 4. Declared authorization (TECH-14)

`access` is a **required** field of `Action` — an action without a declaration
does not compile. Policies are built from the vocabulary in
[actions/access/index.ts](../server/src/actions/access/index.ts)
(`deckEditor`, `projectViewer`, `templateAuthor`, `self`, `signedIn`, …), each
carrying a machine-readable descriptor: a resource (`deck`, `project`, `slide`,
`seedAsset`, `template`, `refineJob`, `self`, `none`) at a level (`view`,
`member`, `edit`, `settings`, `own`, `author`, …), plus non-ACL capabilities
(`google-drive`, `verified-email`). The descriptor is never consulted at
runtime — it exists so the audit test can pin every action's guard in one
table, making a *weakened* guard as visible in review as a missing one.

An action whose rule is genuinely not one-resource-at-one-level declares
`custom(reason)` and must also appear, with its reason, in the short allowlist
at the top of the audit test. Silence is not an option.

Two rules bind every policy (see [policy.ts](../server/src/actions/access/policy.ts)):
policies read **Mongo only** (they run outside the usage context, so a paid
call would spend unattributed), and **missing and forbidden answer alike**, so
an id cannot be probed for existence.

## 5. Adding an action

1. Define it with `defineAction` in the right family file (or a new file) —
   `name`, Zod `input`, `access` from the vocabulary, `meter` if it spends
   toward a plan cap, `execute`.
2. New file? Add it to [register-all.ts](../server/src/actions/register-all.ts).
3. Add its row to `ACCESS_INDEX` in
   [access-registry.test.ts](../server/src/actions/access-registry.test.ts) —
   the test fails until the row matches the declared policy.
4. Call it from the client with `dispatchAction('family.verb', input)`.

## 6. Boundary

Not everything goes through the layer. Media/streaming routes keep their own
checks and are **not** covered by the audit index: `routes/tts.ts`,
`routes/slides.ts`, `routes/seed-assets.ts`, `routes/decks.ts`,
`routes/users.ts`, and `ws/audio-socket.ts`. A green registry test is a
statement about dispatched actions only; narrowing that gap is separate work
([MCP.md §6](MCP.md#6-boundaries)).
