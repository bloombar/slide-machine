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
| Sticky page footer | `z-30` | HealthFooter |
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

**Problem.** SEED-1/2 need instructor documents (PDF/DOCX/photos) feeding slide generation and image enrichment, but every AI credential (Gemini) is still pending.

**Choice.** A two-tier pipeline where the baseline needs no keys:

- **Storage** behind a `FileStorage` seam ([storage/index.ts](../server/src/storage/index.ts)): `local` (disk + `GET /api/files/*`, the dev/test default) or `s3` (MinIO/DO Spaces), selected by `STORAGE_PROVIDER`.
- **Upload** (`POST /api/seed-assets`, 20 MB, PDF/DOCX/PNG/JPEG/WebP) answers immediately with a `processing` asset; extraction runs fire-and-forget and settles to `ready`/`failed` — the same fault-tolerant background pattern as image enrichment. Project-level uploads are owner-only; lecture-level follow deck edit rights.
- **Baseline extraction** ([seeding/extract.ts](../server/src/seeding/extract.ts)): PDF text via unpdf, DOCX text via mammoth plus embedded photos (≥10 KiB, ≤12) spun into their own image assets, uploaded photos used directly with caption-derived keywords. The **AI tier** (vision captions, OCR, summarization) plugs in behind `processSeedAsset` when `GEMINI_API_KEY` lands.
- **Payoffs**: enabled assets' text joins the structured seed layers (`seedContext: { project, deck }`, additive, deck outranks project; 8k chars/layer). Seeded photos enter the enrichment pool with source prior **1.2 — above every web source** — and a model-selected `seededImageId` short-circuits search entirely (`imageSource: 'seeded'`, IMG-1).

## Access control: project-level ACLs with lecture inheritance (2026-07-12)

**Problem.** Privacy was per-lecture only; instructors needed one place to control a whole project, with per-lecture exceptions.

**Choice.** One generalized ACL core ([lib/access.ts](../server/src/lib/access.ts)): every decision — project or lecture — runs through `canViewAcl` / `canEditAcl` over a `ResolvedAcl { ownerId, visibility, viewers, editors, inherited }`.

- **Projects** own their ACL directly (`project.setAccess/share/unshare/shares/transferOwnership`, same semantics as lectures; management by owner + editors, transfer owner-only). Project **editors can edit every inheriting lecture** and the project's seed material; the project *entity* page and member lists are member-only even when visibility is `public` (`isAclMember`) — public opens the lectures by link, not the management surface or seed notes.
- **Lectures store nothing until touched**: no `visibility`/lists on the deck document — the effective ACL is the project's (`resolveDeckAcl`), so project changes cascade automatically. The first lecture-level change (general access, share, unshare, or a transfer) snapshots the project's current settings into `deck.accessOverride` (**copy-on-write**) and detaches the lecture. `deck.resetAccess` drops the override and re-attaches. The DTO carries the *effective* `visibility` plus `accessInherited`, so clients render one field.
- **Client**: one `AccessSettings` component drives both `deck.*` and `project.*` action families; the lecture tab shows "Inherited from the project…" or "Overridden… Use project settings". Ownership transfer now confirms in the shared ConfirmDialog.
