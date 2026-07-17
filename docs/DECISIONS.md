# Design Decisions

Short records of non-obvious choices, for when we revisit them.

## Slide scaling: container-query units (2026-07-11)

**Problem.** Slides render in an `aspect-video` box that tracks viewport width, but typography was fixed-size (`text-5xl` etc.), so decks looked different at every browser width and broke on mobile.

**Choice.** The slide root is a CSS container (`container-type: inline-size`, Tailwind `@container`), and every size inside — font sizes, paddings, gaps, image-slot minimums — is expressed in `cqi` units (1cqi = 1% of slide width) in [SlideView](../client/src/components/SlideView.tsx) and [SlideMarkdown](../client/src/components/SlideMarkdown.tsx). Layout is therefore proportionally identical at any width, pure CSS, no JS measurement.

**Why not the alternative.** The other candidate was the PowerPoint/reveal.js model: render at a fixed design resolution (e.g. 960×540) and `transform: scale()` the whole slide to fit (needs a ResizeObserver). Rejected for now because transforms distort the real geometry that our hover nav zones, in-place editing box reservation, and scroll-into-view depend on, and it needs JS where container units need none.

**If we switch later.** The fixed-design-resolution model becomes attractive when pixel-exact parity with exports matters (PDF / Google Slides, SPEC §11) — an offscreen/export renderer can adopt it independently without changing the interactive viewer. All scaling values live only in the two components above; a switch means replacing `cqi` values with fixed sizes at the design resolution plus a scale wrapper.

Approximate scale used: title 7cqi, section heading 5.5cqi, content/list headings 4cqi, body 2.75cqi (2.5 in two-column), captions 2cqi, paddings 4–8cqi.

## Z-index tiers (2026-07-11)

Fixed tiers so page chrome always paints above slide content:

| Tier | z-index | Used by |
| --- | --- | --- |
| Slide content & nav hotspots | auto | SlideView, SlideNavZones zones |
| In-slide controls | `z-10` | EditableText (display + field), SlideDeleteButton — must beat the nav hotspots only |
| Sticky page chrome | `z-30` | HealthFooter, DeckPageHeader (the deck toolbar pill, pinned under the nav) |
| Primary navigation | `z-50` | AppShell / PublicShell headers |
| Confirmation dialogs | `z-60` | ConfirmDialog — must beat everything, including the nav |

Rule of thumb: nothing inside a slide may exceed `z-10`; nothing outside
page chrome may use `z-30`+. Previously the sticky header sat at `z-10`,
tied with in-slide controls, so slide text could paint over the nav when
scrolled beneath it.

## Slide content slots: descriptor + editor registry (2026-07-11)

**Problem.** Editable slide parts (title, body, bullets) were hardcoded into every layout branch of SlideView, so each new template field — and eventually non-text media — meant touching every layout.

**Choice.** Layouts only *name* their content slots (`slots: LayoutSlot[]`, already the AI-facing vocabulary in [template.ts](../shared/src/types/template.ts)). Each slot has a shared `SlotDescriptor` (`SLOT_DESCRIPTORS`) giving its media `kind` and label, and the client keeps one editor component per kind in [slots.tsx](../client/src/components/slide/slots.tsx) (`text` → in-place markdown editor, `bullets` → whole-list editor, `image` → reserved image slot). [SlideView](../client/src/components/SlideView.tsx) layouts render `slot('title')` etc. and know nothing about editing.

**Adding a media type later** (video, embed, …): extend `SlotKind`, describe the slots that use it in `SLOT_DESCRIPTORS`, register one editor component in the `EDITORS` map. Layouts, SlideView, and the save path (`slide.editContent` partial patches) stay untouched; unknown slots render nothing, so old clients degrade quietly.

## Deck access control: Google-Docs model (2026-07-11)

**Problem.** SPEC §15 sketched `visibility: private | unlisted | public` per deck, with no way to grant specific people view or edit access.

**Choice.** Google-Docs-style ACL on each deck, one mental model users already know:

- **General access** — `visibility: 'public'` (anyone on the internet with the link can view; the default) or `'restricted'` (only people with access can open with the link).
- **People with access** — `viewers[]` / `editors[]` user-id lists, managed by email (`deck.share` / `deck.unshare` / `deck.shares`). A person holds one role; granting the other role moves them, and the per-person menu also offers "Remove access". Editors can always view and edit regardless of general access. Editing covers content (slides, rename, reorder, template, live session) **and access management**; only ownership is different — `deck.transferOwnership` is owner-only ("Transfer ownership" in the per-person menu), hands the deck to another user, and keeps the old owner as an editor. Share lists never leave owner/editor responses to outsiders — public surfaces strip `viewers`/`editors` and carry a `canEdit` flag instead. A transferred deck can live in a project the new owner doesn't own; home and profile group those under "Other lectures".
- `canViewDeck` / `canEditDeck` in [deck.ts](../server/src/models/deck.ts) are the single source of truth, used by the permalink route, `deck.get`, and every content action.

**Profiles.** Users get `profileVisibility: 'public' | 'private'` (default public). `GET /api/users/:id` lists the lectures the requester can view, grouped by project (empty projects omitted). Missing and private both return an identical 404 — profile existence never leaks, same rule as restricted decks.

**Dropped.** The old `unlisted` tier (public-with-link covers it) and a separate deck-level edit-access switch (an earlier draft; the people list alone decides who edits).

## Seed material: upload → keyless extraction → generation (2026-07-11)

**Problem.** [SEED-1](SPEC.md#seed-1-document-seeding)/[2](SPEC.md#seed-2-image-seeding) need instructor documents (PDF/DOCX/photos) feeding slide generation and image enrichment, but every AI credential (Gemini) is still pending.

**Choice.** A two-tier pipeline where the baseline needs no keys:

- **Storage** behind a `FileStorage` seam ([storage/index.ts](../server/src/storage/index.ts)): `local` (disk + `GET /api/files/*`, the dev/test default) or `s3` (MinIO/DO Spaces), selected by `STORAGE_PROVIDER`.
- **Upload** (`POST /api/seed-assets`, 20 MB, PDF/DOCX/PNG/JPEG/WebP) answers immediately with a `processing` asset; extraction runs fire-and-forget and settles to `ready`/`failed` — the same fault-tolerant background pattern as image enrichment. Project-level uploads are owner-only; lecture-level follow deck edit rights.
- **Baseline extraction** ([seeding/extract.ts](../server/src/seeding/extract.ts)): PDF text via unpdf, DOCX text via mammoth plus embedded photos (≥10 KiB, ≤12) spun into their own image assets, uploaded photos used directly with caption-derived keywords. The **AI tier** (vision captions, OCR, summarization) plugs in behind `processSeedAsset` when `GEMINI_API_KEY` lands.
- **Payoffs**: enabled assets' text joins the structured seed layers (`seedContext: { project, deck }`, additive, deck outranks project; 8k chars/layer). Seeded photos enter the enrichment pool with source prior **1.2 — above every web source** — and a model-selected `seededImageId` short-circuits search entirely (`imageSource: 'seeded'`, [IMG-1](SPEC.md#img-1-real-time-image-enrichment)).

## Access control: project-level ACLs with lecture inheritance (2026-07-12)

**Problem.** Privacy was per-lecture only; instructors needed one place to control a whole project, with per-lecture exceptions.

**Choice.** One generalized ACL core ([lib/access.ts](../server/src/lib/access.ts)): every decision — project or lecture — runs through `canViewAcl` / `canEditAcl` over a `ResolvedAcl { ownerId, visibility, viewers, editors, inherited }`.

- **Projects** own their ACL directly (`project.setAccess/share/unshare/shares/transferOwnership`, same semantics as lectures; management by owner + editors, transfer owner-only). Project **editors can edit every inheriting lecture** and the project's seed material; the project *entity* page and member lists are member-only even when visibility is `public` (`isAclMember`) — public opens the lectures by link, not the management surface or seed notes.
- **Lectures store nothing until touched**: no `visibility`/lists on the deck document — the effective ACL is the project's (`resolveDeckAcl`), so project changes cascade automatically. The first lecture-level change (general access, share, unshare, or a transfer) snapshots the project's current settings into `deck.accessOverride` (**copy-on-write**) and detaches the lecture. `deck.resetAccess` drops the override and re-attaches. The DTO carries the *effective* `visibility` plus `accessInherited`, so clients render one field.
- **Client**: one `AccessSettings` component drives both `deck.*` and `project.*` action families; the lecture tab shows "Inherited from the project…" or "Overridden… Use project settings". Ownership transfer now confirms in the shared ConfirmDialog.

## Speech capture: browser bridge until Cloud STT (2026-07-12)

**Problem.** Real speech capture ([CAP-1](SPEC.md#cap-1-session-lifecycle)) is blocked on Google Cloud STT credentials, but live demos shouldn't wait for them.

**Choice.** Capture is a client-side seam ([stt/capture.ts](../client/src/stt/capture.ts)), but the engine is chosen by **one server variable**, `TRANSCRIPTION_PROVIDER`, reported to the client at boot via `GET /api/config` — so switching needs no client rebuild. `browser` (the default) uses the Web Speech API — keyless, Chrome/Edge/Safari, mic-permission gated. `none` disables capture. `google-cloud` streams mic PCM to the server over a WebSocket (`/api/stt`, auth'd on the handshake); the server relays to Google Cloud STT `streamingRecognize` via the [google-cloud-transcription](../server/src/providers/google-cloud-transcription.ts) adapter and streams transcripts back. Every engine's finalized phrases feed the same `session.phrase` pipeline as the typed Speak bar, with interim text shown live — the UI is identical. Real-time streaming requires a **service account** (`GOOGLE_APPLICATION_CREDENTIALS`); Google's streaming endpoint rejects API keys, so the earlier `GOOGLE_CLOUD_STT_KEY` (chunked REST) path was dropped.

**Update (2026-07-16).** The `google-cloud` streaming path is implemented; the switch moved from two env vars (client `VITE_STT_PROVIDER` + server `TRANSCRIPTION_PROVIDER`) to the single server variable above, and `VITE_STT_PROVIDER` was removed.

## Gemini generation adapter: model + output strategy (2026-07-12)

**Problem.** The real GenerationProvider must return one structured slide decision per spoken phrase in near real time (Open Q #5), on the free-tier dev key.

**Measured on our key** (single-phrase prompt, July 2026): `gemini-2.5-flash*` — retired for new users (404); `gemini-2.0-*` — zero quota (429); `gemini-flash-latest` — ~30s; `gemini-3-flash-preview` — ~10s (thinking tokens); **`gemini-3.1-flash-lite-preview` — ~1s, no thinking, correct new/update/none decisions**. That's the `GEMINI_MODEL` default (env-overridable).

**No `responseSchema`.** Gemini's constrained decoding sent every model we tried into degenerate repetition loops (hundreds of duplicated phrases until MAX_TOKENS), while `responseMimeType: application/json` plus the exact shape spelled out in the prompt stays clean. The adapter therefore prompts the contract and enforces it server-side: zod validation, layout drift coerced back to the offered option set, seeded-image ids checked against what was offered, `maxOutputTokens: 2048` as a hard stop. Revisit the schema if a later API fixes constrained decoding. The prompt text itself is externalized to `config/prompts/` — see [GENERATION_PROMPT.md](GENERATION_PROMPT.md).

## Slide layouts: renderer registry (2026-07-12)

**Problem.** Each layout type's arrangement was a hard-coded branch in SlideView, so new layout types — ours or, later, user-authored ones ([TMPL-4](SPEC.md#tmpl-4-custom-templates-create--edit--save)) — meant editing the central renderer.

**Choice.** The same pattern as content slots: a registry. Every layout type is one component implementing `LayoutProps { slide, colors, slot }` in [slide/layouts/](../client/src/components/slide/layouts/), registered by name in `layouts/index.tsx`; [SlideView](../client/src/components/SlideView.tsx) is just the themed container-query frame plus a lookup. `slot(name)` keeps arrangement decoupled from content/editing (the slot system), and colors arrive resolved from the theme. Unknown layout types render through `GenericLayout` — a stack of whatever slots the slide populates — so newer servers or unsupported custom layouts degrade instead of going blank. `LayoutType` stays the strict seven-value union for now; widening it to open strings is the one shared-type change custom layouts will need.

## Voice commands: deterministic matcher live, AI intent flagged off (2026-07-12)

**Problem.** The wake-word matcher ([stt/commands.ts](../client/src/stt/commands.ts)) is reliable but rigid; natural phrasing ("let's go to the next slide") reads as lecture content. Interpreting intent with the generation model risks mid-lecture misfires.

**Choice.** Both paths, one executor. The client-side wake-word matcher stays the always-on live path. Behind `GENERATION_VOICE_COMMANDS` (**default off**), the [CAP-4](SPEC.md#cap-4-voice-commands) command set ([voice-commands.ts](../shared/src/types/voice-commands.ts)) rides along with each `session.phrase`; the model may answer `action: "command"` instead of slide content, validated at every layer (adapter checks the id was offered; the pipeline re-checks the flag; nothing persists — no slide, no transcript). The client runs the returned command through the same `runVoiceCommand` as wake-worded matches. Off by default because the prompt's "unmistakably operating the slide system" bar is the only guard against a misread phrase becoming a surprise navigation; the deterministic tier has no such failure mode.

## Layout re-fit on update: model declares delta vs refit, server audits (2026-07-12)

**Problem.** [GEN-8](SPEC.md#gen-8-new-slide-vs-update-current) says an update may switch the slide's layout (content → list as material grows), but the update contract was delta-only ("return ONLY the added material"), so the model never re-fit — and a naive switch can hide committed content (list layouts don't render `body`).

**Choice.** The model declares its semantics per update via `updateMode` (behind `GENERATION_LAYOUT_REFIT`, **default on**): `delta` keeps the cheap added-material contract and may switch layout only if the target still displays every populated slot; `refit` returns the complete slide re-mapped (the request carries the slide's exact slot content for this). The server audits every claim ([lib/layout-refit.ts](../server/src/lib/layout-refit.ts)): known layout, an image slot never vanishes, displayed slots stay populated, hidden content must demonstrably migrate (≥50% significant-word overlap), and absolute budgets hold. An unverifiable refit is discarded (`none`) rather than half-applied; slot data the new layout hides stays on the document so [EDIT-3](SPEC.md#edit-3-per-slide-layout-switch) strands nothing. Keeps the common delta path at today's token cost — the full-slide response is paid only when the layout actually changes. [GEN-9](SPEC.md#gen-9-animated-layout-transitions)'s animated transition is still future work; refits currently swap instantly.

## Quiz Generator: in-process library, not a separate service (2026-07-17)

**Problem.** [SPEC §17](SPEC.md#17-quiz-generator-integration) originally specified the [Quiz Generator](https://github.com/bloombar/google-forms-quiz-generator) (which publishes quizzes to Google Forms) as a **separate HTTP service** Slide Machine calls. But that repo had no web-service code — it was a CLI — and the split created the hardest open question (§19 Q12): how to delegate the instructor's Google access across two services.

**Choice.** Keep the Quiz Generator a **separate repository** but consume it as a **versioned, in-process library** (a pinned git dependency), not a service. Its form-building core was refactored to **inject** an authorized `OAuth2Client` (the CLI supplies one via its interactive flow; Slide Machine supplies one built from the instructor's [EXP-4](SPEC.md#exp-4-connected-accounts-google-drive--github) connected-account token), a barrel entry point + type declarations were added, and the CLI still works unchanged. Slide Machine's `quiz-bridge` will import it and call it directly ([QUIZ-3](SPEC.md#quiz-3-publishing--link-return)/[QUIZ-4](SPEC.md#quiz-4-delegated-google-access)).

**Why not the alternative.** A separate service means a second deployment plus a cross-service delegated-token model (§19 Q12) — real cost for no benefit at pilot scale, since the Forms/Drive surface is small (~one module) and Slide Machine already holds the instructor's token. In-process, the token never leaves the monolith, and Q12 dissolves. Absorbing the code by copy-paste (instead of a library import) was rejected because it forks the logic from the still-maintained CLI.

**Consequences / limits.** Publishing now depends on **EXP-4** (offline Google OAuth with Forms/Drive scopes + encrypted token store), which is not yet built — a hard predecessor. **Domain-restricted** responses (NYU-Workspace-only) are **deferred**: the Google Forms REST API can't set org restriction (only quiz + email-collection settings), so the pilot ships verified-email collection; true restriction would need the Workspace admin default and/or an Apps Script hop.

**If we switch later.** If the Quiz Generator ever needs to serve other apps over HTTP or scale independently, the same auth-injected core lifts into a thin HTTP service with no rewrite — the extraction the modular-monolith seams ([§13](SPEC.md#13-system-architecture)) are designed for.
