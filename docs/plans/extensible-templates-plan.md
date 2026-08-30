# Extensible slot & template model for specialized slide content

## Context

Lectures in CS, math, chemistry, and language instruction need content the app cannot
currently represent: syntax-highlighted code, LaTeX formulas, preformatted text, and
tables. Today a slide holds exactly five fixed things — `title`, `body`, `bullets[]`,
`caption`, one `imageRef` — and nothing else can be stored, generated, rendered, or
exported.

The goal is the general version, not a special case: a template designer (eventually via
Google Slides import + a metadata editor) defines **however many slots of whatever kinds
they want** on each layout, annotates each slot with what it is for and its limits, and
the AI receives those layouts with full slot metadata and fills them accordingly.

That requirement — *unlimited count of each content type per slide, template-determined* —
is what forces the design. You cannot hand-write a React component for a layout a user
invented with three code blocks and two images, so slide content must become a slot map
and layout arrangement must become data.

This is the codebase's stated destination, not a departure from it.
[docs/TEMPLATES.md:402](docs/TEMPLATES.md#L402)
already names the two blockers: *"Widening `LayoutType` from the fixed union to open
strings, and moving slide content from fixed fields to a slot-name map so custom slots can
persist."*

## What already exists (reuse, don't rebuild)

| Seam | Where | State |
| --- | --- | --- |
| `SlotSpec` — the WYSIWYG-ready slot shape | `shared/src/types/template.ts:89` | Already carries `name/kind/label/multiline/maxChars` + **reserved** `style`/`metadata` |
| Custom-named slots in template files | `builtin.ts` `normalizeSlot` | **Already accepted** — object form with an explicit `kind` may use any name |
| Kind → editor registry | `client/src/components/slide/slots.tsx:356` `EDITORS` | Working registry; documented extension point |
| Layout renderer registry tolerates unknown types | `client/src/components/slide/layouts/index.tsx:23` | Already `Record<string, …>` with a `GenericLayout` fallback |
| Per-slot char budget beats layout constraint | `server/src/lib/slide-fit.ts:46` | `slotChars('title') ?? constraints.maxTitleChars` — half-generalized already |
| Template's SlotSpec overrides conventional descriptor | `slots.tsx:382` | Working |
| Templates are data, zod-validated at load | `server/src/templates/builtin.ts` | Working |
| Normalized 0..1 geometry box model | `server/src/lib/deck-layout.ts` | Exists for PDF/PPTX export — **reuse as the geometry vocabulary** |
| Mixed-type legacy tolerance precedent | `server/src/models/slide.ts` (`attribution` + `toAttributionDto`) | The migration pattern to copy |
| **Google Slides export to Drive** | `export-google.ts:120` `createGoogleSlidesLive`; `actions/export.ts:252`; `ExportPanel.tsx:62`; `e2e/tests/export.spec.ts` | **Already built, do not rebuild** — server action, client format option, 5 locales, e2e. This is the carrier the metadata round trip rides on; the work is making it *carry slot metadata*, not creating it |

## What blocks it (verified, not assumed)

1. **Slide content is fixed columns.** `Slide` has `title/body/bullets/caption/imageRef`
   ([deck.ts:114](shared/src/types/deck.ts)).
   `SLOT_FIELDS` ([slots.tsx:41](client/src/components/slide/slots.tsx#L41))
   maps only those five; `slideEditContent`
   ([actions/slide.ts:72](server/src/actions/slide.ts#L72))
   zod-rejects any other key. **A custom slot renders empty and saves nowhere today.**
2. **Image data is singular and lives outside any slot.** `imageRef`, `imageSource`,
   `imageKeywords`, `attribution` are sibling fields — two images per slide is
   unrepresentable, and per-image credit (IMG-5) has nowhere to go.
3. **`LayoutType` is a closed union of 8**, enumerated in shared types, the builtin zod
   schema, the Mongoose enum, and the import enum.
4. **The AI contract hard-codes four slot names.** `outputShape()` and `resultSchema`
   ([gemini-generation.ts:51,75](server/src/providers/gemini-generation.ts))
   accept exactly `title|body|bullets|caption`. The prompt serializer emits only
   `name (max N chars)` — **slot labels and purpose never reach the model**, and `SlotSpec`
   has no `description` field at all.
5. **No geometry renderer exists.** `elementPositions` has **zero consumers** — declared in
   shared types, defaulted to `{}` in zod, written as `{}` in all three template files and
   every test. `renderMode` and `decorations` appear **nowhere in code** (docs/TEMPLATES.md
   §6–§8 documents them in the present tense; they are unbuilt). Layouts are eight
   hand-written React components; server export is a hardcoded `switch` over the eight
   types (`deck-layout.ts:131`).
6. **No renderers for the new kinds.** `SlideMarkdown` allowlists
   `p br strong em del code a ul ol li` — no `pre`, no tables; code fences flatten to bare
   text. No math engine anywhere. `slide-fit.ts` truncates at word boundaries with `…`,
   which corrupts code and LaTeX.
7. **Google Slides import (TMPL-8) does not exist.** Zero references to the Slides API.
8. **Image enrichment is singular end to end** — see the dedicated section below.

## Target model

```ts
// shared/src/types/template.ts
export type LayoutType = string          // conventional names stay reserved & recognized

export type SlotKind =
  | 'text' | 'bullets' | 'image'                    // existing
  | 'code' | 'math' | 'preformatted' | 'table'      // new

export interface SlotSpec {
  name: string                    // author-chosen, unique within the layout
  kind: SlotKind
  label: string
  description?: string            // NEW — the author's instruction to the AI
  required?: boolean              // NEW
  maxChars?: number
  maxWords?: number               // NEW
  options?: Record<string, unknown>   // NEW, kind-scoped: {language:'python'}, {columns:3}
  style?: Record<string, unknown>
  metadata?: Record<string, unknown>
}
```

> **Geometry does not live on `SlotSpec`.** An earlier draft put a `position` here; it belongs
> on `Layout.elementPositions`, keyed by slot name, together with `decorations` — the shape
> `template-import-plan.md` specifies and docs/TEMPLATES.md §4 already documents. Keying by
> name works unchanged with author-named slots. See **Relationship to the import plan** below.

```ts
// shared/src/types/deck.ts — content becomes a map, values discriminated by kind
export type SlotValue =
  | { kind: 'text' | 'preformatted'; value: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'image'; ref?: string; source?: ImageSource
      keywords?: string[]; attribution?: ImageAttribution }   // credit moves per-image
  | { kind: 'code'; source: string; language?: string }
  | { kind: 'math'; tex: string; display?: boolean }
  | { kind: 'table'; header?: string[]; rows: string[][] }

export interface Slide {
  /* … id, deckId, index, layoutType, sourceTranscript, drawings … */
  slots: Record<string, SlotValue>
}
```

**`SlotKind` stays a closed, code-backed registry** — each kind needs a client editor, an
export renderer, a fit rule, and TTS behavior, so a user cannot invent `kind: "chem-eq"`
without code. What *is* fully user-extensible: slot **names**, slot **count**, layout
**names and count**, per-slot **instructions**, **limits**, **geometry**, and **styling**.
That is the extensibility you asked for; the kind menu is the one closed list, and it grows
by PR.

### Migration lever

Keep `title/body/bullets/caption/imageRef` on the **DTO only**, computed from the slot map
by conventional name. The many existing readers — `deck-structure.ts`, rolling context,
quiz generation, `speakable-text.ts`, `layoutFlip.ts`, the text index — keep working
unchanged while the storage moves underneath. Mirrors the `toAttributionDto` precedent in
`server/src/models/slide.ts`. Drop the derived fields in a later cleanup.

## Image enrichment must become per-slot

Enrichment is singular from the model's guidance all the way to the atomic DB write, so it
is a first-class part of this change, not a follow-on.

**Already generalizes — keep it.** `server/src/lib/image-layout.ts` does *not* hardcode a
layout list: `layoutHasImageSlot` inspects the descriptor's declared slot names, and
`reconcileImageLayout` already upgrades a slide to the tightest image-capable layout that
strands no populated content, dropping image intent when none fits. That logic survives.

**What changes:**

- **Identify image slots by `kind`, not by name.** `image-layout.ts` keys on the literal
  `const IMAGE_SLOT = 'image'`. Once an author can name a slot `diagram` or `photo-left`,
  the test must become `spec.kind === 'image'`. Same for `populatedSlots()`, which currently
  hardcodes `title/body/bullets/caption` — it reads the slot map instead.
- **`imageGuidance` becomes per-slot.** Today it is one `{keywords, seededImageId, none}`
  for the whole slide. It becomes keyed by image-slot name, so the model can request a
  photograph for one slot and a diagram for another. `reconcileImageLayout` then reconciles
  *counts* ("this layout has two image slots; the model filled one") rather than a boolean.
- **`enrichSlideImage(slideId)` → `(slideId, slotName)`.** The atomic claim at
  `enrichment/enrich.ts:129` — `{ _id: slideId, imageRef: { $in: [null, ''] } }`, which
  guarantees enrichment never overwrites a user's image — must target that slot's path
  inside the map. This guard is load-bearing for the race between background enrichment and
  a manual replace; it must stay atomic per slot. N image slots fan out to N independent
  enrichment jobs.
- **Slot metadata feeds the AI re-rank.** `SlideImageContext` (`enrichment/types.ts:41`)
  hardcodes `title/body/bullets/caption`. It gains the slot map plus **which slot is being
  filled and that slot's `description`** — so an author's instruction ("only a photograph of
  the historical figure discussed") directly steers candidate selection and caption wording
  in `ai-rank.ts`. This is a real quality gain, not just plumbing.
- **Caption pairing.** `enrich.ts:112` writes a caption alongside the image, guarded by
  `captionMode: 'replace' | 'fill'`. With several images per slide, "the caption" is
  ambiguous. Resolve it in the template: `SlotSpec.options.captionSlot` names the caption
  slot paired with this image slot, defaulting to `<imageSlotName>-caption` when present.
- **`LAYOUT_HAS_IMAGE`** (`deck-layout.ts:60`), the one genuinely hardcoded set
  (`['image-heavy','two-column']`), becomes derived from the layout's slot kinds.
- **`deck.ts` seeded-image application** (`actions/deck.ts:140`) carries the same singular
  `imageRef`/`imageSource` write and needs the same per-slot treatment.

Fan-out lands in **Phase 1** (storage + `enrichSlideImage` signature), **Phase 2**
(per-slot `imageGuidance` in the AI contract), and **Phase 3** (multi-image rendering).

## Carrying our metadata through Google Slides

Google Slides cannot express slot kinds, descriptions, or limits, so a round trip needs a
sidecar channel. Speaker notes are one; there is a better one for the per-slot case, and the
two are complementary rather than competing.

### How a slot is identified — the association problem

A single JSON blob in speaker notes has to answer "which shape is which slot?", and every
available correlation key is bad:

| Key | Why it fails |
| --- | --- |
| `objectId` | Not stable. Duplicating a slide reassigns ids, and on PPTX→Drive conversion **Drive assigns the ids** — we cannot predict what to write. |
| Placeholder `type`/`index` | Survives conversion but is coarse: a handful of types (TITLE/BODY/PICTURE), so three code slots on one layout collide. |
| Z-order ordinal | Any reorder in the Google UI silently remaps every slot. |
| Bounding-box match | Fuzzy; breaks the moment someone nudges a shape. |

**Resolution: the slot's own name is the key, and it is written on the element itself.**
Every `PageElement` in the Slides API carries `title` and `description` (the accessibility
alt-text fields), so association becomes structural — there is no lookup table to keep in
sync:

```text
Layout "code-walkthrough"
 ├ pageElement (shape)  altText.title = "slot:explanation"   ← IS that slot
 ├ pageElement (shape)  altText.title = "slot:code-1"        ← geometry read from
 ├ pageElement (shape)  altText.title = "slot:code-2"           the same element
 ├ pageElement (image)  altText.title = "slot:diagram"
 └ pageElement (shape)  (no token)                           ← decoration, ignored
```

On import: walk each page's `pageElements`; an element whose alt text matches `slot:<name>`
**is** that slot, and its `size` + `transform` become `SlotSpec.position`. Untokenized
elements are decoration.

Keep the per-element token **short** (`slot:code-1`) rather than a full JSON blob: Google's
Alt text pane displays both fields to the user, and a wall of JSON there is ugly and invites
deletion. The bulky part — kind, description, limits, options — lives in the template blob
keyed by `<layoutName>/<slotName>`, which the short token resolves against.

**This is also why notes alone cannot work for templates.** Layouts are pages with their own
`pageElements`, but **speaker notes exist only on slides, never on layouts** — so per-layout
slot metadata has no home in notes at all, and per-layout slots are exactly what template
derivation (TMPL-8) must recover.

**Per-slide narration → speaker notes.** This is the semantically correct use of that field,
and the app already has the content for it: `Slide.sourceTranscript`. Exporting narration
into speaker notes is a small, currently-missing win worth taking in the same pass. If any
machine data must also live there, keep it *below* a sentinel line so presenter view shows
the instructor their script, not JSON.

**Per-template metadata** (version, theme, layout inventory) has no natural per-element home.
Put it on the first slide's notes below the sentinel, or in a Drive sidecar file. Note Drive
`appProperties` is **not** viable — ~124 bytes per property and ~30 properties total is far
too small for a template.

**The carrier already ships.** Native Google Slides export to Drive is built and wired
(see the table above) — and it is the *only* export that can round-trip, since a PDF can
carry no slot identity. Nothing new is needed to enable this; Phase 4 simply teaches the
existing export to write the metadata.

**Scope consequence — this stays cheap.** Export today never calls the Slides API; it uploads
a `.pptx` and lets Drive convert it (`export-google.ts`), which is why
[GOOGLE_API_KEYS.md:251](docs/GOOGLE_API_KEYS.md#L251)
can say export needs no Slides scope. PPTX has both speaker notes and shape alt text
(`descr`), and pptxgenjs exposes them — so **write the metadata into the PPTX and keep the
`drive.file`-only story intact**. A post-conversion Slides `batchUpdate` would instead need a
Slides *write* scope, which is neither requested nor in the documented plan. Verify pptxgenjs
alt-text coverage for every shape type we emit before committing to this.

**Treat it as untrusted, advisory data.** It crosses a trust boundary — an instructor can
edit or delete notes and alt text in Google's UI, and the converter may not preserve
everything. So: version the payload, zod-validate it, cap its size, and on any failure fall
back to inferring slots from geometry and placeholder type — the path TMPL-8 needs regardless
for presentations this app never wrote. Metadata makes the round trip *lossless* when present;
its absence must degrade, never fail.

## Phases

### Phase 1 — Open the data model

- `shared/src/types/template.ts`: widen `LayoutType` to `string` (keep `LAYOUT_TYPES` as the
  reserved conventional set), extend `SlotKind`, add the new `SlotSpec` fields.
- `shared/src/types/deck.ts`: add `slots: Record<string, SlotValue>`; keep the five legacy
  fields as derived-on-read.
- `server/src/models/slide.ts`: `slots` as `Schema.Types.Mixed`; a read-time normalizer
  synthesizes the map from legacy fields when absent. Maintain a denormalized `searchText`
  string on save so the existing `slide_text` index keeps working.
- `server/src/templates/builtin.ts`: relax the `type` enum, validate slot-name uniqueness,
  cap `description` length, validate `options` per kind.
- `server/src/actions/slide.ts` (`slideEditContent`): accept `slots` patches validated
  against the slide's layout spec; reject unknown slot names.
- `server/src/lib/deck-yaml.ts` / `deck-import.ts`: round-trip the slot map (EXP-3's
  guarantee must hold for the new content).

### Phase 2 — Dynamic AI contract

- `SlotSpec.description` + limits reach the model. `instructions()` in
  `gemini-generation.ts` serializes each layout as its slots with kind, label,
  description, and limits.
- `outputShape()` becomes `"slots": { "<slot name from the chosen layout>": <value> }` with
  the per-kind value shapes spelled out; `resultSchema` validates dynamically against the
  chosen layout's declared slots — unknown keys dropped, kind shapes coerced, missing
  required slots logged.
- Same treatment for `config/prompts/{generation,refine,reformat}.txt` and
  `refine-prompts.ts`.
- `slide-fit.ts`: budgets become per-slot-name; **non-prose kinds are exempt from
  word-boundary truncation** (clamp code by line, never mid-token; never truncate LaTeX).
- **Prompt-budget guard.** Generation runs per finalized phrase in a live lecture, so
  descriptor bloat costs latency. Cap `description` (~200 chars, enforced in zod), omit
  descriptions for self-evident conventional slots, cap the total descriptor block, and log
  when it truncates (no silent caps).

### Phase 3 — Kind renderers (client)

- New entries in `EDITORS` (`client/src/components/slide/slots.tsx`): `CodeSlot`
  (highlight.js, language from `options.language`), `MathSlot` (KaTeX), `PreformattedSlot`,
  `TableSlot`. Each pairs a display renderer with an `EditableText`-style raw-source editor,
  reusing the existing debounced-autosave component.
- `slots.tsx` `SLOT_FIELDS` is replaced by slot-map lookup; `layouts/types.ts` widens
  `slot: (name: string) => ReactNode`.
- Multiple images per slide fall out of the slot map; the attribution dialog binds to the
  slot's own credit.
- `layoutFlip.ts` keys on `slide.id:slotName` — already the shape it uses.

### Phase 4 — Full-fidelity export

- `deck-layout.ts`: `computeLayout` reads `SlotSpec.position` geometry when present, falling
  back to the existing switch for built-ins that have none.
- Per-kind export renderers: **code** → colored monospace runs (highlight.js tokens →
  colors); **math** → MathJax `tex2svg` → `sharp` → PNG, embedded via `pdf-lib.embedPng` and
  `pptxgenjs.addImage`; **table** → `pptxgenjs.addTable` natively, manual grid in pdf-lib;
  **preformatted** → monospace, no wrap.
- `speakable-text.ts`: skip or substitute a short stand-in for code/math/table slots so TTS
  doesn't read LaTeX aloud.
- `deck-pptx.ts` writes the round-trip metadata: a `slot:<name>` alt-text token on every
  emitted shape, `Slide.sourceTranscript` into speaker notes via `addNotes`, and the template
  blob below the sentinel on slide 1. Confirm pptxgenjs alt-text coverage for each shape type
  before relying on it, and assert Drive's converter preserves both across a live round trip.

### Phase 5 — Geometry renderer (client)

**This phase is not separate work: it *is* `template-import-plan.md`'s
`feat/TMPL-8-positioned-renderer` PR**, and that plan owns the detail. It consumes
`Layout.elementPositions` so an imported or author-defined layout renders without a bespoke
component — which is what makes "any number of slots of any kind" renderable at all, since no
one can hand-write a component for a layout a user invented.

Two things from that plan this one adopts wholesale:

- **`Template.renderMode: 'components' | 'positioned'`** — an explicit field, not an inference
  from "does this template have geometry". Geometry has two consumers (the renderer and the
  pptx exporter), so a built-in gaining geometry *for export* must not silently change how it
  *renders*.
- Built-ins keep their hand-written components until a side-by-side comparison shows parity,
  then convert and delete.

### Phase 6 — Authoring

Google Slides import (**TMPL-8**, currently zero code — needs the Slides API; the scope
line here is superseded, `presentations.get` accepts the `drive.file` the app already
holds, see GOOGLE_API_KEYS.md §6) derives layouts, geometry, and slots. Two paths, and the second is the one that must work well:

- **Presentations we exported** carry `slot:<name>` alt-text tokens and the template blob, so
  import is lossless — kinds, descriptions, and limits all survive.
- **Presentations we never wrote** have no tokens. Infer slots from placeholder type and
  geometry, default every slot to `kind: 'text'`, and say plainly that the import is lossy —
  the honesty TMPL-8 already promises. The metadata editor is how the author then fixes it.

The slot-metadata editor (**TMPL-4**) is where the author sets each slot's kind, description,
and limits. Phase 6 is what makes the whole thing user-facing rather than a JSON-file feature.

## SPEC / board changes

Requirement text drives the project board (`scripts/board`), so append new IDs — never
renumber. Add under §7: **TMPL-9** (open slot & layout model), **TMPL-10** (slot metadata and
authoring instructions). Under §9: **GEN-11** (AI fills arbitrary declared slots per their
metadata). Under §10: **EDIT-7** (editing specialized slot kinds). Under §11: **EXP-7**
(specialized-content export fidelity) and **EXP-8** (slot metadata carried through Google
Slides round trips). Under §9: **IMG-6** (per-slot image enrichment). Add riders to
**TMPL-2**/**TMPL-6** (the layout list is now conventional, not exhaustive), **GEN-7** and
**IMG-1/5** (guidance, sourcing, and credit all become per-slot), **TMPL-8**/**EXP-5**
(metadata-assisted import), **EXP-1/2/3**, and the §15 `Slide`/`Layout`/`SlideTranslation`
data-model lines.

**Status: done.** These SPEC edits and the corresponding docs/TEMPLATES.md amendments
(§2 open layout names and the content-kind table, §3 slot-guided generation and the descriptor
budget, §4 the contract-test caveat, §7 the preferred-vocabulary rule, §8 the metadata carrier
and specialized-content export, §9 the ceiling removed, §13 one deferred item left) have
landed. Run `npm run board:derive && npm run board:sync` to create the cards the PRs close.

## Relationship to `template-import-plan.md`

The two plans are one program and must be read together. That plan owns Google Slides
import/export, template persistence, the positioned renderer, and layout consolidation; this
one owns the open slot model, content kinds, and the dynamic AI contract. Where they met, six
points were reconciled:

1. **Geometry** lives on `Layout.elementPositions` (that plan's shape), not on `SlotSpec`.
2. **`renderMode`** is adopted from that plan, with its rationale.
3. **The seven-layout ceiling is removed** — that plan explicitly deferred widening
   `LayoutType`; this plan requires it, and it lands **before** the importer so consolidation
   never writes coercion logic that would be deleted immediately after.
4. **Speaker notes are now carried**, reversing that plan's "ignored in this slice".
5. **Slot kinds extend that plan's derivation call** — the same LLM pass that assigns layout
   semantics also proposes each slot's kind and description, while geometry stays
   deterministic and every slot defaults to `text`.
6. **Import writes the slot map**, so the slot model must land before EXP-5 lecture import.

One regression this plan introduces into that one, with its mitigation: consolidation pass 5
merges candidates sharing an LLM-assigned layout type, and open type names could defeat it
entirely. The semantics prompt therefore presents the conventional types as a **preferred
vocabulary**, and "a model returning many novel names still consolidates" becomes a tested
property. See docs/TEMPLATES.md §7.

Also agreed: **one YAML version bump, not two** (geometry, decorations, slot kinds and
descriptions all land in `TEMPLATE_YAML_VERSION` 2; the deck format bumps once for the slot
map), and the `Template` Mongoose schema is **authored open from day one** so PR 1 does not
force a second migration within a release.

## Risks

- **Model drift on arbitrary slot names** is the top quality risk — the model currently emits
  four known keys. Mitigate by validating against the chosen layout's declared names,
  dropping unknowns, and keeping the existing `action: 'none'` fallback rather than guessing.
- **Live-generation latency** from richer descriptors (see the Phase 2 budget guard).
- **Author-written descriptions are untrusted text** flowing into a prompt — cap length and
  treat as data, never as instructions to the system.
- **Two math engines** (KaTeX client, MathJax server) is a smell accepted deliberately: KaTeX
  is fast and CSS-based for live rendering, MathJax is the practical server-side SVG path.
  Golden-image tests should pin that they agree.
- **The Google round trip depends on someone else's converter.** Whether Drive preserves
  PPTX alt text and speaker notes is an empirical question, not a design choice. Verify it
  early — before Phase 4 commits to the alt-text carrier — because the fallback (a Slides
  write scope, or a Drive sidecar file) changes the scope story in GOOGLE_API_KEYS.md.
- **Slot-map migration touches nearly every content reader.** The derived-DTO lever above is
  what keeps that from becoming a big-bang rewrite; if it proves leaky, the honest response is
  to migrate readers explicitly rather than widen the compatibility shim.

## Verification

- **Unit**: zod round-trips for each `SlotValue` kind; `normalizeSlot` name-uniqueness and
  kind-option validation; per-kind clamping in `slide-fit.ts` (assert code is never truncated
  mid-token); legacy-slide normalizer synthesizes the map correctly.
- **Contract**: extend `client/src/components/slide/layouts/contract.test.tsx` — declared vs.
  rendered slot sets must still match with open names.
- **Integration**: a fixture template with a custom multi-slot layout (2 code + 1 math + 2
  image); assert the serialized prompt carries descriptions and that a mock model response
  keyed by custom slot names persists and reads back.
- **Export**: golden PDF/PPTX for a deck containing code, math, a table, and two images;
  assert math rasterizes rather than emitting literal LaTeX.
- **Google round trip**: export a deck with custom slots to Drive, re-read it, and assert
  every `slot:<name>` token and the notes payload survived conversion — this is the one claim
  that depends on Google's converter rather than on our code, so it needs a live test, not a
  unit test. Also assert graceful degradation: strip the tokens and confirm import still
  produces a usable, honestly-labeled lossy template.
- **E2E (Playwright, live stack + test db, per CLAUDE.md)**: author a code slide and a math
  slide through the in-place editor, reload, export to PDF, and re-import the YAML —
  confirming EXP-3's round-trip guarantee holds for the new content.
- **Regression**: full `npm run lint && npm run format:check && npm run typecheck && npm test`
  before any PR; run integration/e2e files individually if they flake under full-suite load.

## Merged sequence

The phases above are not shipped standalone; they interleave with
`template-import-plan.md`'s PRs. Docs land first, because board issues derive from the SPEC.

| # | Branch | Content | Plan |
| --- | --- | --- | --- |
| 0 | *(direct to default branch)* | SPEC, TEMPLATES.md, both plans, ROADMAP. Markdown and `docs/` are the documented exception to branch-and-PR | both |
| 1 | `feat/TMPL-8-template-storage` | Mongo `Template` model, async resolver + ~8 call-site refactor, CRUD, soft delete, `deletedLayouts`, refcounted asset purge. **Schema authored open** | import |
| 2 | `feat/TMPL-9-slot-model` | Phase 1 — widen `LayoutType`, slot map on `Slide`, derived-DTO lever, per-slot enrichment signatures | this |
| 3 | `feat/GEN-11-dynamic-slots` | Phase 2 — dynamic AI contract keyed by declared slot names, per-slot `imageGuidance`, per-slot budgets | this |
| 4 | `feat/EDIT-7-slot-kinds` | Phase 3 + the PDF/PPTX half of Phase 4 — the feature ships complete for JSON-authored templates here | this |
| 5 | `feat/TMPL-8-positioned-renderer` | Phase 5 — geometry types, `PositionedLayout`, `renderMode`, theme extension | import |
| 6 | `feat/TMPL-8-slides-import` | Scope, IR reader, consolidation, derivation. Emits open types + proposed slot kinds; reads alt-text tokens when present | import |
| 7 | `feat/EXP-5-lecture-import` | Content mapping → **slot map** | import |
| 8 | `feat/EXP-6-template-export` | YAML v2, `template-pptx.ts`, deck master mode, **plus the metadata carrier** and the round-trip tests | both |

- **PR 2 before PR 6** is the whole point of conflict 3 above.
- **Between PR 2 and PR 5**, an open layout type declares fine but renders through
  `GenericLayout`. That is acceptable — the registry already falls back gracefully rather than
  rendering blank — but say so, or it reads as a bug.
- **PR 1 stays the riskiest** despite adding no user-facing behavior: making template
  resolution async reaches into deck rendering, export, and seeding.

One cross-plan test proves the two compose: **a template with author-named slots of several
kinds survives export → Drive → import with kinds, descriptions and limits intact.**
