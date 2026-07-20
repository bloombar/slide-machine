# Design Decisions

Short records of non-obvious choices, for when we revisit them.

## Slide scaling: container-query units (2026-07-11)

**Problem.** Slides render in an `aspect-video` box that tracks viewport width, but typography was fixed-size (`text-5xl` etc.), so decks looked different at every browser width and broke on mobile.

**Choice.** The slide root is a CSS container (`container-type: inline-size`, Tailwind `@container`), and every size inside — font sizes, paddings, gaps, image-slot minimums — is expressed in `cqi` units (1cqi = 1% of slide width) in [SlideView](../client/src/components/SlideView.tsx) and [SlideMarkdown](../client/src/components/SlideMarkdown.tsx). Layout is therefore proportionally identical at any width, pure CSS, no JS measurement.

**Why not the alternative.** The other candidate was the PowerPoint/reveal.js model: render at a fixed design resolution (e.g. 960×540) and `transform: scale()` the whole slide to fit (needs a ResizeObserver). Rejected for now because transforms distort the real geometry that our hover nav zones, in-place editing box reservation, and scroll-into-view depend on, and it needs JS where container units need none.

**If we switch later.** The fixed-design-resolution model becomes attractive when pixel-exact parity with exports matters (PDF / Google Slides, SPEC §11) — an offscreen/export renderer can adopt it independently without changing the interactive viewer. All scaling values live only in the two components above; a switch means replacing `cqi` values with fixed sizes at the design resolution plus a scale wrapper.

Approximate scale used: title 7cqi, section heading 5.5cqi, content/list headings 4cqi, body 2.75cqi (2.5 in two-column), captions 2cqi, paddings 4–8cqi.

## Z-index tiers (2026-07-11, modal tier 2026-07-18)

Fixed tiers so each layer always paints above the ones below it:

| Tier | z-index | Used by |
| --- | --- | --- |
| Slide content & nav hotspots | auto | SlideView, SlideNavZones zones |
| In-slide controls | `z-10` | EditableText (display + field), SlideMenu, image-slot controls — must beat the nav hotspots only |
| Sticky page chrome | `z-30` | HealthFooter, DeckPageHeader (the deck toolbar pill), the live-session pill |
| Settings sheet & chrome popovers | `z-40` | Modal `sheet` variant (drops under the nav), HealthBadge panel |
| Primary navigation | `z-50` | AppShell / PublicShell headers |
| Modal & confirmation dialogs | `z-60` | Modal `center` variant, ReplaceImageDialog, ImageAttributionDialog, SeedDialog, ConfirmDialog — full-screen overlays that must beat everything, including the nav |

Two rules keep this working:

1. **Nothing inside a slide may exceed `z-10`; nothing outside page chrome
   may use `z-30`+.** Previously the sticky header sat at `z-10`, tied with
   in-slide controls, so slide text could paint over the nav when scrolled
   beneath it.
2. **Full-screen modal overlays render through `<Portal>` (into
   document.body), not inline.** A dialog's z-index only competes within its
   nearest stacking-context ancestor, so a dialog mounted inside an in-slide
   control (the image slot's `z-10` group) was trapped at `z-10` and painted
   under the `z-30` deck toolbar no matter its own value. Portaling lifts
   every modal to the document root so the `z-60` tier actually applies.

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

**Problem.** [SEED-1](SPEC.md#seed-1-document-seeding)/[2](SPEC.md#seed-2-image-seeding) need instructor documents (PDF/DOCX/photos) feeding slide generation and image enrichment, and this had to work before any AI credential (Gemini) was guaranteed — so the baseline could not hard-depend on a key.

**Choice.** A two-tier pipeline where the baseline needs no keys:

- **Storage** behind a `FileStorage` seam ([storage/index.ts](../server/src/storage/index.ts)): `local` (disk + `GET /api/files/*`, the dev/test default) or `s3` (MinIO/DO Spaces), selected by `STORAGE_PROVIDER`.
- **Upload** (`POST /api/seed-assets`, 20 MB, PDF/DOCX/PNG/JPEG/WebP) answers immediately with a `processing` asset; extraction runs fire-and-forget and settles to `ready`/`failed` — the same fault-tolerant background pattern as image enrichment. Project-level uploads are owner-only; lecture-level follow deck edit rights.
- **Baseline extraction** ([seeding/extract.ts](../server/src/seeding/extract.ts)): PDF text via unpdf, DOCX text via mammoth plus embedded photos (≥10 KiB, ≤12) spun into their own image assets, uploaded photos used directly with caption-derived keywords. The **AI tier** ([seeding/ai-extract.ts](../server/src/seeding/ai-extract.ts) — vision captions, OCR, summarization) is implemented and layers on inside `processSeedAsset` automatically whenever `GEMINI_API_KEY` is present; it returns null (never throws) without a key, so the keyless baseline stands unchanged.
- **Payoffs**: enabled assets' text joins the structured seed layers (`seedContext: { project, deck }`, additive, deck outranks project; 8k chars/layer). Seeded photos enter the enrichment pool with source prior **1.2 — above every web source** — and a model-selected `seededImageId` short-circuits search entirely (`imageSource: 'seeded'`, [IMG-1](SPEC.md#img-1-real-time-image-enrichment)).

## Access control: project-level ACLs with lecture inheritance (2026-07-12)

**Problem.** Privacy was per-lecture only; instructors needed one place to control a whole project, with per-lecture exceptions.

**Choice.** One generalized ACL core ([lib/access.ts](../server/src/lib/access.ts)): every decision — project or lecture — runs through `canViewAcl` / `canEditAcl` over a `ResolvedAcl { ownerId, visibility, viewers, editors, inherited }`.

- **Projects** own their ACL directly (`project.setAccess/share/unshare/shares/transferOwnership`, same semantics as lectures; management by owner + editors, transfer owner-only). Project **editors can edit every inheriting lecture** and the project's seed material; the project *entity* page and member lists are member-only even when visibility is `public` (`isAclMember`) — public opens the lectures by link, not the management surface or seed notes.
- **Lectures store nothing until touched**: no `visibility`/lists on the deck document — the effective ACL is the project's (`resolveDeckAcl`), so project changes cascade automatically. The first lecture-level change (general access, share, unshare, or a transfer) snapshots the project's current settings into `deck.accessOverride` (**copy-on-write**) and detaches the lecture. `deck.resetAccess` drops the override and re-attaches. The DTO carries the *effective* `visibility` plus `accessInherited`, so clients render one field.
- **Client**: one `AccessSettings` component drives both `deck.*` and `project.*` action families; the lecture tab shows "Inherited from the project…" or "Overridden… Use project settings". Ownership transfer now confirms in the shared ConfirmDialog.

## Speech capture: browser bridge until Cloud STT (2026-07-12)

**Problem.** Real speech capture ([CAP-1](SPEC.md#cap-1-session-lifecycle)) needed Google Cloud STT credentials that weren't yet in hand, but live demos shouldn't wait for them.

**Choice.** Capture is a client-side seam ([stt/capture.ts](../client/src/stt/capture.ts)), but the engine is chosen by **one server variable**, `TRANSCRIPTION_PROVIDER`, reported to the client at boot via `GET /api/config` — so switching needs no client rebuild. `browser` (the default) uses the Web Speech API — keyless, Chrome/Edge/Safari, mic-permission gated. `none` disables capture. `google-cloud` streams mic PCM to the server over a WebSocket (`/api/stt`, auth'd on the handshake); the server relays to Google Cloud STT `streamingRecognize` via the [google-cloud-transcription](../server/src/providers/google-cloud-transcription.ts) adapter and streams transcripts back. Every engine's finalized phrases feed the same `session.phrase` pipeline as the typed Speak bar, with interim text shown live — the UI is identical. Real-time streaming requires a **service account** (`GOOGLE_APPLICATION_CREDENTIALS`); Google's streaming endpoint rejects API keys, so the earlier `GOOGLE_CLOUD_STT_KEY` (chunked REST) path was dropped.

**Update (2026-07-16).** The `google-cloud` streaming path is now fully implemented and selectable ([google-cloud-transcription](../server/src/providers/google-cloud-transcription.ts) + the live `/api/stt` WebSocket); `browser` remains the default `TRANSCRIPTION_PROVIDER`, with `google-cloud` switched on by setting that one variable plus service-account credentials. The switch also moved from two env vars (client `VITE_STT_PROVIDER` + server `TRANSCRIPTION_PROVIDER`) to the single server variable above, and `VITE_STT_PROVIDER` was removed.

## No speaker diarization: latency + single-provider (2026-07-18)

**Problem.** In a live lecture the mic picks up the lecturer and, intermittently, students asking questions or commenting. Diarization (labelling *who* spoke) would let us treat student speech differently — skip it, tag it, or route it separately.

**Choice.** Do **not** diarize. Keep transcription a single undifferentiated stream and stay on Google Cloud STT streaming. Two reasons: (1) we want interim/final transcripts as fast as possible, and Google returns speaker tags only in **batch** recognition, not the streaming path [CAP-1](SPEC.md#cap-1-session-lifecycle) depends on — real-time and diarization are mutually exclusive on Google today; (2) providers that *do* diarize live (Deepgram, AssemblyAI) would mean adding a second STT vendor, which we're declining. The `TranscriptionEvent` contract ([transcription.ts](../shared/src/providers/transcription.ts)) therefore carries only `text`/`isFinal`/`confidence` — no `speaker` field — and every phrase feeds the same `session.phrase` pipeline regardless of who spoke.

**Consequences / limits.**

- **Student speech is indistinguishable from the lecturer's.** A student question or comment enters generation as if the lecturer said it, and may spawn or update a slide. There is no automatic way to skip, quarantine, or attribute it.
- Mitigations remain manual/deterministic: the lecturer can pause capture during Q&A, or use voice commands / the Speak bar to steer. The existing wake-word matcher ([stt/commands.ts](../client/src/stt/commands.ts)) is unaffected.
- No per-speaker analytics or transcripts (e.g. "questions asked this lecture").

**If we switch later.** Adding a `speaker` field to `TranscriptionEvent` and threading it through the phrase pipeline is the enabling change; the provider registry ([registry.ts](../server/src/providers/registry.ts)) already isolates the STT vendor, so a diarizing adapter (batch Google, or a live-diarization provider) drops in without touching capture or the UI. Speaker-aware handling (drop/tag/route student turns) would then be a pipeline policy on top.

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

## Image AI re-rank + caption reconciliation (2026-07-18)

**Problem.** A slide's caption is authored by the generation model **blind to the image** (at slide-creation time), while the image is sourced **afterward** by background enrichment ranked only by keyword overlap ([scoring.ts](../server/src/enrichment/scoring.ts)). On layouts that pair the two (image-heavy), the caption and the picture often disagree.

**Choice.** After candidates are gathered, one Gemini call ([enrichment/ai-rank.ts](../server/src/enrichment/ai-rank.ts)) both **picks the candidate that best fits the slide** and **rewrites the caption to match it** — given the full slide content + lecture seed context and the candidates' metadata. It runs inside `enrichImage`: shortlist the top `IMAGE_RERANK_SHORTLIST` by heuristic score, hand them to the model, and use its choice; on any failure (no key, timeout, bad reply, or `index=-1`) fall back to the existing `pickBest` (IMG-2 — never break the pipeline, keyless baseline stands). The caption is written in the **same `updateOne` as `imageRef`** so it reaches the client through the existing image poll for free (the poll resolves on `imageRef` and swaps the whole slide; `toSlideDto` already carries `caption`). Overwrite policy: `replace` on a fresh generated slide, `fill` (only when empty) on updates and manual layout switches, so a user's caption edit is never clobbered. Text-only by default; `IMAGE_RERANK_VISION` (default **off**) additionally sends candidate thumbnails so the model judges visually — more accurate, slower, hence opt-in. All counts are env-tunable (`IMAGE_SOURCE_RESULTS`, `IMAGE_MAX_QUERY_PHRASES`, `IMAGE_RERANK_SHORTLIST`) with code defaults, so absence from the env file changes nothing. The client image poll widened to ~18s to absorb the extra step.

## Quiz Generator: in-process library, not a separate service (2026-07-17)

**Problem.** [SPEC §17](SPEC.md#17-quiz-generator-integration) originally specified the [Quiz Generator](https://github.com/bloombar/google-forms-quiz-generator) (which publishes quizzes to Google Forms) as a **separate HTTP service** Slide Machine calls. But that repo had no web-service code — it was a CLI — and the split created the hardest open question (§19 Q12): how to delegate the instructor's Google access across two services.

**Choice.** Keep the Quiz Generator a **separate repository** but consume it as a **versioned, in-process library** (a pinned git dependency), not a service. Its form-building core was refactored to **inject** an authorized `OAuth2Client` (the CLI supplies one via its interactive flow; Slide Machine supplies one built from the instructor's [EXP-4](SPEC.md#exp-4-connected-accounts-google-drive--github) connected-account token), a barrel entry point + type declarations were added, and the CLI still works unchanged. Slide Machine's `quiz-bridge` will import it and call it directly ([QUIZ-3](SPEC.md#quiz-3-publishing--link-return)/[QUIZ-4](SPEC.md#quiz-4-delegated-google-access)).

**Why not the alternative.** A separate service means a second deployment plus a cross-service delegated-token model (§19 Q12) — real cost for no benefit at pilot scale, since the Forms/Drive surface is small (~one module) and Slide Machine already holds the instructor's token. In-process, the token never leaves the monolith, and Q12 dissolves. Absorbing the code by copy-paste (instead of a library import) was rejected because it forks the logic from the still-maintained CLI.

**Consequences / limits.** Publishing now depends on **EXP-4** (offline Google OAuth with Forms/Drive scopes + encrypted token store), which is not yet built — a hard predecessor. **Domain-restricted** responses (NYU-Workspace-only) are **deferred**: the Google Forms REST API can't set org restriction (only quiz + email-collection settings), so the pilot ships verified-email collection; true restriction would need the Workspace admin default and/or an Apps Script hop.

**If we switch later.** If the Quiz Generator ever needs to serve other apps over HTTP or scale independently, the same auth-injected core lifts into a thin HTTP service with no rewrite — the extraction the modular-monolith seams ([§13](SPEC.md#13-system-architecture)) are designed for.

## Speaker diarization: post-hoc two-pass, not real-time (2026-07-20)

**Problem.** Slide generation should treat the lecturer as authoritative and mark student speech as questions/feedback ([GEN-4](SPEC.md#gen-4-post-lecture-reformat)), which needs to know who is speaking. Google Speech-to-Text **cannot diarize a real-time stream** — diarization exists only in the v2 `Recognize`/`BatchRecognize` (Chirp 3) methods, which are post-hoc, and even legacy streaming diarization only finalizes speaker tags at end-of-stream. Live generation is per-phrase and real-time ([sessionPhrase](../server/src/actions/deck.ts)), so speaker identity cannot exist at live-generation time.

**Choice.** A **two-pass** pipeline. The live path stays speaker-blind (real-time captions + provisional slides, unchanged). A **post-lecture reformat** then batch-diarizes retained audio, **time-joins** speaker tags onto the transcript, maps speakers to roles (most-talk-time = lecturer, with manual confirm), and enriches/regenerates slides. Reformat is **hybrid**: regenerate only student/mixed slides, and protect lecturer-only, hand-edited (`manuallyEdited`), and manually-added slides. Batch diarization reads audio from a **GCS bucket** (`BatchRecognize` accepts `gs://` only, so audio is uploaded there even though app blob storage is S3-compatible); whole-file batch is required because speaker tags are not consistent across chunked requests.

**Why not the alternative.** Legacy `v1p1beta1` streaming diarization technically runs live, but its tags only stabilize at end-of-stream (no true real-time attribution) and the model is weaker — so it buys nothing over the batch pass. Full deck regeneration was rejected (discards generated images, edits, and slide ids); label-only enrichment was rejected (can't rewrite content already written speaker-blind).

**Staging.** Groundwork ships first (see next entry) with **zero user-visible change**; audio retention (Phase 2), batch diarization + time-join (Phase 3), and the reformat action (Phase 4) build on top. GCS/batch setup is documented in [GOOGLE_API_KEYS.md](GOOGLE_API_KEYS.md) when Phase 2 lands.

## Transcript segments: own collection, session-scoped timings (2026-07-20)

**Problem.** The diarization time-join needs a structured, timestamped transcript, but the live record is two flat strings (`deck.transcript`, `slide.sourceTranscript`) with no timing, confidence, speaker, or phrase→slide linkage — and recording can **stop/start freely** (no global audio clock) while slides are **added/edited/deleted** independently (so slide order is not a proxy for the audio timeline).

**Choice.** Capture a `TranscriptSegment` per finalized phrase in its **own append-only collection** ([models/transcript-segment.ts](../server/src/models/transcript-segment.ts)) — not embedded on the deck, which `sessionPhrase` already rewrites per phrase and which would risk the 16 MB document cap on long lectures. Each segment carries word-level timings + confidence, a client-minted **`sessionId`** (one per capture start = one recording, since there is no global clock), and its `action`/`slideId` linkage recorded **at write time**. Word offsets are made session-absolute in the STT adapter by accumulating a byte-derived offset across the ~240 s stream restarts; slides gain a `manuallyEdited` flag so the reformat never clobbers hand-edits. The flat strings keep being written **byte-identically** and no DTO exposes segments yet, so end-user behavior is unchanged. The write uses **insert-early, refine-late**: the segment is inserted right after the flat-string append (guaranteeing parity, auto-excluding voice commands) and its `action`/`slideId` are refined once the slide outcome is known.

**Why not the alternative.** Storing timings on the existing strings was impossible (they're plain text); a per-slide structured array was unnecessary (the segment's `slideId` gives slide→segments) and would duplicate data mutated by manual slide edits. Reconstructing the phrase→slide linkage post-hoc from slide order was rejected — free editing scrambles it, so it must be recorded live.

## Audio retention: server-side tee to blob storage, GCS deferred (2026-07-20)

**Problem.** Batch diarization (Phase 3) needs the lecture audio, but the STT transport streams it straight through to Google and keeps no copy; the client streams (never retains) it, so the audio only exists server-side, mid-flight. Google `BatchRecognize` ultimately reads from a `gs://` bucket, which is not yet provisioned.

**Choice.** Tee the PCM already flowing through the STT WebSocket ([ws/audio-socket.ts](../server/src/ws/audio-socket.ts)): buffer each session's frames, and on socket close wrap them in a canonical WAV ([lib/wav.ts](../server/src/lib/wav.ts)) and store the blob via the existing `FileStorage` seam, recording a reference on the deck (`recordings[]`, server-only — the raw audio is never exposed in a DTO), keyed by the same `sessionId` the transcript segments carry. Gated behind `AUDIO_RETENTION_ENABLED` (default **off**) and only for the **google-cloud engine** (the browser engine's audio never reaches the server). The connecting user's **edit access to the deck is verified** before anything persists (checked async so no early audio is dropped), and buffering is capped at ~300 MB per session (transcription continues past the cap). The **GCS copy the batch pass reads is deferred to Phase 3** — a marked seam in the flush sets each recording's `gcsUri` once the bucket exists.

**Why not the alternative.** Uploading from the client was impossible (it doesn't retain the streamed audio). Blocking on GCS would have stalled all of Phase 2 on an unprovisioned bucket; blob-first keeps the audio captured now, and the `gs://` copy is an additive step. In-memory buffering (vs. streaming to disk/multipart) is a deliberate first-cut simplicity, bounded by the cap; a streaming upload is a later refinement if long sessions warrant it.

**Retention window / deletion.** Retained audio is purely intermediate (needed only until diarization consumes it) and contains student voices, so it is not kept indefinitely — for cost *and* privacy. A daily app-side sweep ([jobs/audio-cleanup.ts](../server/src/jobs/audio-cleanup.ts)) deletes any recording older than `AUDIO_RETENTION_DAYS` (default 30, `0` = keep forever): the WAV *and* its deck reference, so storage and the DB stay consistent. The trigger is time-based here because there is no diarization yet; **Phase 3 will additionally delete a recording as soon as the batch pass consumes it** (more eager — this sweep then only catches un-processed audio), and will remove the `gs://` copy too. A Spaces/S3 lifecycle rule scoped to the **`audio/` prefix** is a complementary zero-code guard (documented in [DEPLOY.md](DEPLOY.md)), but it is blind to the DB and can leave a dangling reference — so the app-side sweep is the source of truth, and the Phase-3 read path must tolerate a missing audio object. The `audio/` prefix is isolated from images (`slides/`), TTS (`tts/`), and seed (`seed/`), so prefix-scoped expiry is safe.
