# Import style templates (and lectures) from Google Slides

## Context

> **Superseded on scopes.** This plan predates the Picker migration. The app
> now requests **`drive.file` and nothing else** — no `presentations.readonly`,
> no `drive.readonly`, no `forms.body*`. Every method named below accepts
> `drive.file`, and the Drive browsing described here is done by Google's own
> Picker. See [GOOGLE_API_KEYS.md §6](../GOOGLE_API_KEYS.md#one-scope-on-purpose)
> and [GOOGLE_PRODUCTION_MODE.md](../GOOGLE_PRODUCTION_MODE.md). The rest of
> the plan stands as the record of how import was built.


The SPEC promises export/import of decks **and templates**, but only ever specifies
Google Slides in the deck-export direction ([SPEC.md:525](docs/SPEC.md#L525)). Nothing
imports a template from anywhere, and — the constraint that shapes this whole plan —
**nothing in the codebase writes a template at all**. Templates are read-only JSON
files in `server/config/templates/`, loaded synchronously by
[builtin.ts](server/src/templates/builtin.ts); there is no Mongoose model, no
`template.create`, and no template library UI beyond a 50-line swatch picker.

Instructors overwhelmingly arrive with an existing Google Slides deck that already
carries their institution's or their own design. Today they can only pick one of our
three built-ins. This feature lets them point at a Google Slides presentation and get
that design back as a first-class template in our system.

Two user intents, sharing one derivation engine:

1. **Import a lecture** — from a Google Slides deck: derive its template *and* import
   the slide content into a new lecture deck rendered with that template.
2. **Import a design template** — point at a Google Slides deck purely as a style
   reference; derive and save the template, ignore its content.

Each intent works whether or not the source presentation has real Google masters: if
it does we read them directly; if it doesn't we infer layouts from how its slides are
actually built.

> **Read with [`extensible-templates-plan.md`](extensible-templates-plan.md).** The two plans
> are one program. That one opens the slot and layout model — any number of author-named slots
> per layout, open layout type names, and specialized content kinds (code, math, tables,
> preformatted) — and this one derives, renders, and round-trips designs. Six points where they
> met were reconciled; the specifics are marked **[reconciled]** inline below, and the merged
> PR order is in that plan's *Merged sequence*. The single most important consequence: **the
> fixed `LayoutType` union is being widened, and that lands before this plan's importer**, so
> nothing here should be written to coerce designs into seven conventional types.

Import alone would leave the system lopsided, so this feature also completes the
**export** side: templates must travel to Google Slides and back, and to YAML and back,
exactly as lectures already do.

## Interoperability matrix

The target state. ✅ = already built, ➕ = this feature.

| | YAML export | YAML import | Google Slides export | Google Slides import |
| --- | --- | --- | --- | --- |
| **Lecture (deck)** | ✅ `export.download` / `export.toDrive` | ✅ `deck.import` | ✅ flat · ➕ reusable layouts | ➕ **EXP-5** |
| **Template** | ✅ `template.export` (download only) | ➕ **EXP-3** completion | ➕ **EXP-6** | ➕ **TMPL-8** |

Three gaps behind that table are easy to miss:

- **`template.export` is download-only.** Decks can be saved straight to Drive; templates
  can't. Add the to-Drive path for parity.
- **The template YAML format loses the design.** `templateToYaml` serializes only
  `type`/`label`/`purpose`/`slots`/`constraints`
  ([template-yaml.ts:26-34](server/src/lib/template-yaml.ts#L26-L34)). Once
  `elementPositions` carries real geometry, a YAML round-trip would silently discard
  everything this feature imports. The format must carry geometry and decorations —
  **and [reconciled] every slot's `kind`, `description`, `required` and limits** — in a
  single bump of `TEMPLATE_YAML_VERSION` to 2, keeping v1 readable on import.
- **Deck → Google Slides has no *option* to carry layouts.** `deck-pptx.ts` calls
  `pptx.addSlide()` with no master, so an exported lecture arrives as flat slides. That
  output stays exactly as it is and remains the default — it is the right answer for
  handing someone a finished deck. What's missing is the *alternative*: exporting with
  reusable layouts attached, which is what makes export → re-import round-trip.

## Decisions taken

| Decision | Choice |
| --- | --- |
| Source of truth | Slides API `presentations.get`, behind a provider-neutral IR so a `.pptx` reader can be added later |
| Derivation | Geometry deterministic; LLM only for semantics (layout type, label, purpose, constraints — and **[reconciled]** proposed slot kind + description, every slot defaulting to `text`) |
| Fidelity | Colors, geometry, font mapping, **plus** background images and logos into object storage |
| Rendering | New positioned renderer for imported templates only; built-ins keep their hand-tuned components |
| Storage scope | Template persistence + import + library listing. **No visual editor** (stays TMPL-4) |
| Metering | `importMb` for the import; `aiTokens` automatically for the inference pass |

## Architecture

Four stages, each independently testable. Stages 2–4 never touch Google.

```text
Google Slides ──▶ 1. read ──▶ SourcePresentation (IR) ──▶ 2. derive ──▶ DerivedTemplate
                                                                            │
                                          ┌─────────────────────────────────┤
                                          ▼                                 ▼
                              3. persist template                4. (lecture intent only)
                                                                    map slides → deck
```

**Stage 1 — read** (`server/src/templates/slides-source.ts`)
`presentations.get` via `google.slides({version:'v1', auth})` — `googleapis` is already
a declared dependency and unused by app code ([server/package.json:29](server/package.json#L29)).
Normalize into a provider-neutral `SourcePresentation`: page size, master `colorScheme`,
layouts (when present), and per-slide `pageElements` with placeholder type, normalized
box, text runs and styles, and image `contentUrl`. This IR is the seam a future `.pptx`
reader plugs into — nothing downstream may reference a Google-shaped field.

**Stage 2 — derive** (`server/src/templates/derive.ts`)

- *Theme*: master `colorScheme` (DARK1/LIGHT1/ACCENT1…) → our `background`/`surface`/
  `text`/`muted`/`accent`, plus `penColor`/`highlighterColor` derived as today's
  built-ins do. Font families resolved through a small mapping table to a bundled CSS
  font stack — **we never fetch Google Fonts at runtime**.
- *Layout candidates*: if the presentation has masters/layouts, each becomes a
  candidate directly. Otherwise they are derived by clustering and normalization —
  see **Consolidating near-duplicate layouts** below, which is the heart of the
  inference path.
- *Geometry*: each candidate's placeholders become `elementPositions` entries keyed by
  slot name; non-slot recurring elements (logos, rules) become `decorations`.
- *Semantics (the only LLM call)*: hand the model the layout skeletons — slot arity,
  positions, relative sizes, sample text lengths — and get back `type`, `label`,
  `purpose`, `constraints` per layout, **plus each slot's proposed `kind` and
  `description` [reconciled]**. Extending this call's schema is nearly free and is what makes
  an imported template immediately useful for specialized content. It does **not** weaken the
  geometry-deterministic rule: slot detection stays geometric and every slot defaults to
  `kind: 'text'`, because mistaking prose for code is worse than not recognizing code. A
  proposed specialized kind is a suggestion the author confirms in the editor.
  **`type` is now an open string [reconciled]** — see pass 5 below for why the prompt must
  still push the model toward the conventional names. **No images are sent.** Follow the repo's
  convention exactly: `responseMimeType: 'application/json'`, deliberately **no**
  `responseSchema` ([gemini-generation.ts:44-49](server/src/providers/gemini-generation.ts#L44-L49)),
  zod-validate the reply, and call `meterGeminiUsage` so `aiTokens` is metered for free.
  On any failure return `null` and fall back to rule-based typing (image + little text
  → `image-heavy`; bulleted body → `list`; title only → `section`; …) with canned
  purpose strings — the same degrade-don't-throw posture as
  [ai-rank.ts:155-158](server/src/enrichment/ai-rank.ts#L155-L158).
- *Assets*: download background fills and decoration images to object storage via the
  existing `storage.put` under `templates/<id>/…`. Guard with the byte/MIME/timeout
  limits already proven in `fetchThumb` ([ai-rank.ts:53-70](server/src/enrichment/ai-rank.ts#L53-L70)) —
  Slides `contentUrl` values expire, so they must be fetched at import time.
- *Synthesize the required `whiteboard` layout* — the schema rejects a template without
  one ([builtin.ts:110-118](server/src/templates/builtin.ts#L110-L118)).

**Stage 3 — persist**: write a `Template` document owned by the importer.

**Stage 4 — map content** (lecture intent only, `server/src/templates/slides-content.ts`)
Clustering in stage 2 already assigned every source slide to a derived layout, so
`layoutType` per slide is already known. Only slot filling remains, and it is
deterministic: `TITLE`/`CENTERED_TITLE` → `title`; `BODY` with bulleted paragraphs →
`bullets`, without → `body`; `SUBTITLE` → `caption`; image elements → image slots
(downloaded to storage).

**[reconciled] Content is written to the slide's slot map, keyed by slot name** — not to the
five fixed fields, which no longer exist by the time this ships. Every image element gets its
own image slot rather than only the dominant one, since a layout may declare several. This is
why the slot model (`feat/TMPL-9-slot-model`) must land before this stage is written.

**[reconciled] Speaker notes are no longer ignored.** A presentation this system exported
carries slot metadata in element alt text and a payload in the notes, so import reads it and
restores names, kinds, descriptions and limits exactly; a slide's narration round-trips
through the notes into `sourceTranscript`. When the metadata is absent, damaged, or from an
unknown version, import falls back to the inference path above — degraded, never failed. The
mechanism and the reasoning are in docs/TEMPLATES.md §8.

## Consolidating near-duplicate layouts

Real instructor decks are not cleanly templated. The same "title and bullets" slide gets
rebuilt by hand a dozen times, each with the title box nudged a few pixels and the body
box a hair wider. Treating those as distinct layouts would produce a template with twenty
near-identical entries — useless. The derivation must recognize them as one design and
emit a single, *tidier* layout than any individual slide actually had.

Five passes, all deterministic except where noted. Thresholds are module constants with
documented rationale, following the `SCORE_THRESHOLD` precedent in
[enrichment/scoring.ts:20](server/src/enrichment/scoring.ts#L20).

**1. Group by slot composition.** The coarse key is *which* slots a slide has — title,
body, bullets, image, caption — not where they are. Slides with different compositions
are never merged, however similar their geometry. This is exact, so it costs nothing and
prevents the worst mistakes.

**2. Cluster geometrically, by tolerance not by rounding.** Within a composition group,
distance between two slides is the **maximum** per-slot box distance,
`max(|Δx|, |Δy|, |Δw|, |Δh|)` in normalized units — max rather than mean so one badly
misplaced slot cannot be averaged away by three well-placed ones. Cluster with
average-linkage agglomerative clustering under `MERGE_TOLERANCE = 0.02` (2% of the slide
edge, ≈19px on a 960pt deck).

> Rounding into buckets is the obvious approach and is wrong: two slides differing by
> 0.1% land in different buckets whenever they straddle a bucket boundary. Tolerance-based
> linkage has no boundaries. Average-linkage rather than single-linkage because
> single-linkage chains — a run of slides each 1.9% from the last would merge into one
> cluster spanning 20%.

**3. Derive the canonical box by median, not by exemplar.** Each slot's `x/y/w/h` in the
merged layout is the **median** across cluster members. A medoid just picks one real slide
and inherits its jitter; the median inherits nobody's, and is unmoved by an outlier slide
someone dragged askew. Outliers beyond tolerance from the final median are reported in the
warnings list rather than silently absorbed.

**4. Standardize — the pass that makes the result look designed.** Medians alone still
leave a title at `x=0.0812` in one layout and `x=0.0798` in another. Run template-wide,
not per-layout:

- **Align edges.** Collect every slot edge across every derived layout; cluster the values
  under `SNAP_TOLERANCE = 0.015` and replace each with its cluster's median. Left edges
  that were all "about 8%" become exactly one shared value, so the design has real margins
  and a real grid instead of approximate ones.
- **Unify recurring slots.** A `title` that lands in the same place across most layouts is
  snapped to one common box in all of them — the single most visible cue that a deck was
  templated rather than hand-built.
- **Quantize the type scale.** Cluster font sizes under `FONT_TOLERANCE = 1.5pt` and snap
  each to its cluster median, yielding a handful of sizes rather than a continuum.
- **Collapse near-identical colors** into the derived palette under a small ΔE threshold.
  Hand-built decks are full of `#1c1917` and `#1c1918` meaning the same thing.

**5. Semantic merge — the second, looser pass.** Only now does the LLM assign each
candidate a `type`. Two candidates that received the **same type** and sit within a
looser `SEMANTIC_MERGE_TOLERANCE = 0.06` are merged, re-running passes 3 and 4 over the
union. This is what the model is genuinely better than geometry at: recognizing that a
title-left/image-right layout and a title-right/image-left layout are both `two-column`,
or that two visually distinct arrangements are both section dividers.

> **[reconciled] This pass now rests on prompt wording, not on a closed type union.** Once
> `LayoutType` is open, a model inventing one name per layout would merge nothing — silently
> defeating the pass whose entire purpose is preventing 25 layouts from a 40-slide deck. The
> semantics prompt must therefore present the conventional types as a **preferred vocabulary**:
> reuse one whenever it fits, invent a name only when none does. Merging still requires type
> equality *and* geometric proximity, unchanged. This trades a type-system guarantee for a
> prompt property, which is strictly weaker — so it needs the explicit test listed under
> **Verification**: a model returning many novel type names must still consolidate.

**Singletons do not become layouts.** A cluster must reach `MIN_CLUSTER_SIZE = 2`, or be
master-derived, to be emitted. A one-off slide is assigned to its nearest compatible
layout and reported as approximated — otherwise a 40-slide deck yields 25 layouts, which
is the failure this whole section exists to prevent.

**Report the consolidation.** The warnings list states what happened in the terms an
instructor would recognize: *"38 slides → 6 layouts. Merged 11 near-identical title-and-
bullets slides; 2 slides did not match any layout and were approximated."* This is the
only visibility into a lossy step, so it is a deliverable, not a nicety.

Every pass here is pure geometry-in, geometry-out, so it unit-tests against fixtures
without a database, a network, or a model.

## Data model changes

**`shared/src/types/template.ts`** — give the two reserved fields a real shape:

```ts
/** A slot's box on the slide, normalized 0–1 from the top-left. */
export interface ElementPosition {
  x: number; y: number; w: number; h: number
  z?: number
  align?: 'start' | 'center' | 'end'
  vAlign?: 'start' | 'center' | 'end'
  /** Font size in cqi so text scales with the slide box, as the built-ins do. */
  fontSize?: number
  fontWeight?: number
  /** Resolved hex, or a theme key ('accent', 'muted', …). */
  color?: string
}

/** A static, non-editable element (logo, rule, background band). */
export interface LayoutDecoration {
  kind: 'image' | 'rect'
  position: ElementPosition
  /** Object-storage URL for `image`; fill color for `rect`. */
  src?: string
  fill?: string
}
```

`Layout.elementPositions` narrows from `Record<string, unknown>` to
`Record<string, ElementPosition>`; add `Layout.decorations?: LayoutDecoration[]`.

Also add **`Template.renderMode?: 'components' | 'positioned'`**, defaulting to
`'components'`. Which renderer a template uses must be an explicit property, *not*
inferred from whether `elementPositions` is populated:

> Geometry now has two independent consumers — the positioned renderer and the pptx
> master exporter. Keying rendering off "has geometry" means that the moment a built-in
> template gains geometry so it can export with layouts, it silently reroutes to a
> different renderer and its appearance changes. One explicit field keeps the two
> concerns separate: built-ins may carry geometry for export while still rendering
> through their hand-tuned components; the importer sets `'positioned'`.
Extend the theme resolver in [client/src/components/slide/theme.ts](client/src/components/slide/theme.ts)
with `fontFamily`, `headingFontFamily`, `backgroundImage` — leaving `ThemeColors`
itself intact so every existing caller is untouched.

**New `server/src/models/template.ts`** — the file schema *is* the document schema, as
[docs/TEMPLATES.md](docs/TEMPLATES.md) already anticipates. **[reconciled] Author it open from
day one**: `type` as a string rather than the closed enum, and slots carrying `kind` (including
the specialized kinds), `description`, `required`, `maxWords` and `options`. Writing this
schema closed and widening it two PRs later would force a second migration inside one release,
for no benefit. Fields:
`ownerId`, `name`, `theme`, `layouts`, `renderMode`, `visibility`, `voteScore`, `source`
(`'builtin' | 'google-slides' | 'yaml'`), `sourceFileId`, `assetKeys` (storage keys owned
by this template, so the purge can find them without re-walking the theme and layouts),
and `deletedLayouts` — plus `softDeletePlugin`, as every other owned entity carries. See
**Deletion and retention** below.

**`server/src/templates/builtin.ts` → a resolver.** `getBuiltinTemplate` /
`listBuiltinTemplates` become async `getTemplate(id)` / `listTemplates(userId)` that
merge the JSON built-ins with the user's stored templates. Roughly 8 sync call sites
must be awaited: `actions/deck.ts`, `project.ts`, `slide.ts`, `reconcile.ts`,
`export.ts`, `deck-import.ts`, `routes/decks.ts`, `db/seed.ts`. **This is the single
largest mechanical change in the plan.**

> **Authorization subtlety:** `routes/decks.ts` embeds the full template in every deck
> view, including public permalinks. Resolution *by id* must therefore not check
> ownership — a viewer of a shared deck has to be able to load its template. Ownership
> gates `template.list` and every mutation, not template resolution.

## Server work

- **New OAuth scope.** Add `https://www.googleapis.com/auth/presentations.readonly` to
  `CONNECT_SCOPES` ([google-connect.ts:54](server/src/auth/google-connect.ts#L54)) and add
  a `grantedSlidesAccess` check mirroring the existing `grantedDriveAccess`. Already-
  connected instructors must reconnect once; the UI must detect the missing scope and
  prompt, exactly as the quiz panel's reconnect path does.
- **Extract `googleClientForUser(userId)`.** The load → `isConnected` → `decryptToken`
  triple is currently copy-pasted six times across `actions/quiz.ts` and
  `actions/export.ts`. Extract it before adding a seventh caller.
- **Drive file listing.** `quiz-google.ts` lists folders only; add a files listing
  filtered to `mimeType='application/vnd.google-apps.presentation'` so the picker can
  browse presentations. Needs no new scope — `drive.readonly` is already granted.
- **Mock/live split is mandatory** — the whole test suite runs in mock. Add
  `IMPORT_MODE=mock|live` to [env.ts](server/src/config/env.ts) alongside
  `QUIZ_PUBLISH_MODE`/`EXPORT_MODE`, with `lib/import-google.ts` (live) and a mock twin
  returning a fixture presentation.
- **New actions**, registered in the side-effect import list in
  [server/src/app.ts](server/src/app.ts#L23-L35) — omitting that line 404s them:
  - `template.importFromSlides` → `{ fileId }` → `Template`
  - `template.rename` / `template.duplicate` / `template.delete` (tombstone)
  - `template.deleteLayout` / `template.restoreLayout` — move a layout to and from
    `deletedLayouts`, enforcing the whiteboard, last-layout and in-use guards
  - `deck.importFromSlides` → `{ projectId, fileId }` → `{ deck, template, warnings }`
  - `drive.presentations` → `{ parentId }` → file list for the picker
- **Metering.** `meter: requireImportVolume` on both import actions, then
  `meterUsage('importMb', bytes / BYTES_PER_MB)` once the payload and downloaded asset
  sizes are known — the deferred-quantity idiom from
  [deck-import.ts:184](server/src/actions/deck-import.ts#L184). `aiTokens` needs no
  explicit call if the Gemini request goes through `meterGeminiUsage`.

## Deletion and retention

Imported templates are the first entity in the system that owns **object-storage assets
of its own** (backgrounds, logos). Deleting one must therefore behave like every other
owned record: tombstone now, purge records **and files** at the retention cutoff
([P-10](docs/SPEC.md#L798)/P-11). The existing sweep already does exactly this for seed
assets, so the work is to join that contract rather than invent one.

**Templates.** The model carries `softDeletePlugin`, so `template.delete` sets `deletedAt`
and every read excludes it automatically. Add `TemplateModel` to the "children tombstoned
individually" block of
[jobs/soft-delete-purge.ts](server/src/jobs/soft-delete-purge.ts), deleting its stored
assets first — the same shape as the `storageKey` loop already there for seed assets.
Admin recovery (ADMIN-6) and restore work unchanged via `withDeleted`.

**Layouts.** A layout is a subdocument in an array, not a record, so the sweep's
collection queries cannot reach it and it has no tombstone of its own. Rather than adding
`deletedAt` inside `layouts[]` — which would force every consumer of that array
(`layoutDescriptors`, the renderer, the GEN-6 option set, the pptx exporter) to learn to
filter — move deleted layouts to a sibling array:

```ts
deletedLayouts: [{ layout: Layout, deletedAt: Date }]
```

`layouts` therefore stays exactly what it is today and **no downstream consumer changes**.
Restore moves an entry back; the sweep drops entries past the cutoff and purges any asset
they leave orphaned.

**Asset purging must be reference-counted.** A logo can be referenced by several layouts
and a background by the theme, so purging one layout may not delete a blob another still
uses. Delete an asset only when nothing else in the template refers to it — live layouts,
`deletedLayouts` still inside their window, or the theme. This mirrors the refcounting
already applied to TTS assets (`feat/P-11-tts-refcount`); reuse that approach rather than
a second one.

**Deletion is refused, not silently destructive, when something depends on it.** Each of
these returns a clear error naming what blocks it, so the user can act:

- A template still referenced by a **live** deck or project cannot be deleted. Tombstoned
  decks don't block — they are on their way out — but a deck restored during its window
  whose template was purged falls back to its project default, then `classic`, mirroring
  the fallback [deck-import.ts:56](server/src/lib/deck-import.ts#L56) already takes.
- The **`whiteboard` layout can never be deleted** — the schema rejects a template without
  one ([builtin.ts:110-118](server/src/templates/builtin.ts#L110-L118)) — nor can the last
  remaining content layout.
- A layout in use by live slides cannot be deleted until those slides move off it; the
  error carries the count.
- **Built-in templates cannot be deleted at all.** They are files, not records. The
  resolver must reject the attempt rather than returning a confusing not-found.

Template assets are not metered against a storage cap; there is no `templateStorageMb`
gauge and this plan does not add one. Worth a note in the SPEC so the omission is a
decision rather than an oversight.

## Export work

**Google Slides has no separate "template" file type** — a template there is just a
presentation whose masters and layouts define the design. So exporting a template means
producing a presentation whose *layouts* are ours, with one demo slide per layout so it
is immediately usable.

**Route: pptx masters → Drive conversion.** The Slides API cannot create masters or
layouts — `presentations.batchUpdate` can only apply layouts a presentation already has
— so the API route is a dead end for authoring. `pptxgenjs`, already used for deck
export, has `defineSlideMaster({ title, background, objects })`, which maps almost
one-to-one onto a `Layout` with `elementPositions` and `decorations`. Drive's existing
`.pptx` → Slides conversion then turns those masters into native Slides layouts. This
reuses `uploadFileToDriveLive` unchanged and needs **no new OAuth scope** — `drive.file`
already covers files the app creates.

That gives a genuine round-trip: our exporter writes masters, our importer reads them.

- **New `server/src/lib/template-pptx.ts`** — `templateToPptx(template)`: one
  `defineSlideMaster` per layout (skipping `whiteboard`), then one demo slide per master
  populated with placeholder text drawn from the layout's `label`/`purpose`, so the
  design is visible rather than an empty deck.
- **[reconciled] The exporter writes the round-trip metadata.** Every emitted shape carries a
  short `slot:<name>` token in its alt text, the bulky per-slot payload (kind, description,
  limits, options) goes in a versioned notes payload keyed by that name, and a slide's
  `sourceTranscript` goes into speaker notes as narration. Writing it **into the pptx** — not
  via a Slides `batchUpdate` afterwards — is what keeps the "no Slides write scope" property
  above true. Confirm pptxgenjs alt-text coverage for every shape type emitted before relying
  on it; whether Drive's converter preserves alt text and notes is empirical and must be
  verified on a live round trip before this PR commits to the carrier. Fallbacks if it does
  not: a Slides write scope, or a Drive sidecar file — either of which changes the scope story
  in `docs/GOOGLE_API_KEYS.md`, so find out early.
- **[reconciled] Specialized content must render, not leak source.** Math typeset (never raw
  LaTeX), code monospaced with highlighting where the format supports colored runs, tables as
  real tables, preformatted text spacing-exact — in PDF and Google Slides alike (SPEC EXP-7).
- **Deck → Slides gains a second mode; the existing one is untouched.**
  `server/src/lib/deck-pptx.ts` keeps producing today's flat deck — `pptx.addSlide()` with
  no master — as the **default**. A new opt-in mode defines masters from the deck's
  template and attaches each slide to the master matching its `layoutType`, so the
  exported presentation carries reusable Slides layouts.

  | Mode | Output | When |
  | --- | --- | --- |
  | **Flat** (default) | Slides with baked-in formatting, no reusable layouts | Today's behavior, unchanged. Hand off a finished deck; nothing to maintain |
  | **With layouts** | Masters per layout, each slide attached to one | Keep editing in Slides, restyle globally, or re-import later |

  Carried on the action as `includeLayouts?: boolean`, mirroring the existing
  `includeWhiteboard` option on the same call
  ([export.ts:263](server/src/actions/export.ts#L263)) — except **defaulting to `false`**,
  not `true`. `includeWhiteboard` defaults on because it is additive to a proven output;
  `includeLayouts` restructures the file that Drive then converts, so the shipped,
  proven path stays the default and the new one is chosen deliberately. Easy to flip once
  it has mileage.

  **The option requires template geometry.** A deck on a built-in template has nothing to
  build masters from (`elementPositions` is `{}`), so the option is offered only when the
  deck's template carries geometry — imported templates today, editor-authored ones later
  — and is disabled with an explanation otherwise. Authoring geometry for the three
  built-ins would extend the option to most decks; it is a bounded, optional add-on to
  PR 5 rather than a requirement, and it does **not** change how they render (see the
  `renderMode` note below).
- **New/extended actions**: `template.exportToDrive` (`format: 'yaml' | 'google-slides'`)
  and `template.import` (YAML), mirroring `export.toDrive` and `deck.import` including
  their `exports` metering and saved-export tracking.
- **`shared/src/types/export.ts`** — add `TemplateExportFormat = 'yaml' | 'google-slides'`.
  PDF stays deck-only; a template has no content to paginate.
- **`template-yaml.ts` v2** — carry `elementPositions`, `decorations`, and the theme's new
  typography/background keys, **plus every slot's `name`, `kind`, `description`, `required`
  and limits [reconciled]**. One bump carries both plans' additions — v2 then v3 within a
  release would be self-inflicted. The deck YAML likewise bumps once, for the slot map. Add
  `templateFromYaml` with the validate-everything-then-
  write posture of [lib/deck-import.ts](server/src/lib/deck-import.ts). Note that
  `deck-import.ts:56` silently falls back to `classic` on an unknown template id; a
  template import must **fail loudly** instead — there is nothing sensible to fall back to.
- **Asset handling on export** — background images and logos live in our object storage;
  embed them into the `.pptx` so the exported file is self-contained rather than
  referencing URLs that a Google account may not be able to read.

## Client work

- **`PositionedLayout.tsx`** — grown from `GenericLayout`, which the codebase already
  documents as the seed of the data-driven engine. Absolutely positions each slot from
  `elementPositions` using percentage boxes and `cqi` font sizes so it scales with the
  slide container, paints `decorations` beneath the slots, and keeps the exact
  `LayoutProps` contract. `getLayoutRenderer` gains one rule: **use the positioned
  renderer when the template's `renderMode` is `'positioned'`**, otherwise resolve by
  `layoutType` as today. Built-ins are unaffected regardless of whether they later carry
  geometry for export.
- **Minimal Templates library route** (delivers the outstanding TMPL-1): list built-in
  and owned templates as preview cards, with rename / duplicate / delete and the
  **Import from Google Slides** entry point. Deliberately not an editor.
- **Drive presentation picker** — generalize the Finder-style folder browser already in
  [QuizPanel.tsx:182-296](client/src/components/QuizPanel.tsx#L182-L296) into a shared
  component that can also list files, and reuse it for both intents.
- **Lecture-import entry point** — add "From Google Slides" beside the existing YAML
  import in [CreateMenu.tsx](client/src/components/CreateMenu.tsx#L64-L72).
- **Template export/import UI** — on the library route, per-template export offering
  YAML download, YAML to Drive, and Google Slides to Drive, plus a YAML import. Reuse
  [ExportPanel.tsx](client/src/components/ExportPanel.tsx)'s destination and
  folder-picker patterns rather than inventing a second export UX.
- **Deck export gains a layouts choice** — in `ExportPanel.tsx`, when the target is
  Google Slides, offer flat vs. reusable layouts beside the existing include-whiteboard
  toggle. Word it in terms of what the user gets ("keep the design editable in Google
  Slides"), not in terms of masters. Hidden, not merely disabled, when the deck's
  template has no geometry — an option that can never be chosen is noise.
- **i18n** — every new string in all five bundles (`en`, `fr`, `es`, `ru`, `zh`);
  `client/src/i18n/bundles.test.ts` fails the build otherwise. Imported template names
  and author-written labels are *data* and stay untranslated, per docs/I18N.md.

## SPEC update

> **Status: this section has landed.** TMPL-8, EXP-5 and EXP-6 exist in the SPEC, and
> docs/TEMPLATES.md has been rewritten to the target shape below. What remains outstanding is
> the *code*. A later docs pass added the extensible-slot requirements alongside these —
> TMPL-9, TMPL-10, GEN-11, IMG-6, EDIT-7, EXP-7, EXP-8 — and amended several of the
> requirements below; see **[reconciled]** markers and that plan's *Relationship* section.

Board issues derive from the SPEC, so **requirements land first, before any code**.
Never alter an existing ID — renaming one orphans its issue and creates a new card.

Follow the parser's formats exactly (`.claude/CLAUDE.md`): requirements are
`#### <ID> <Title>` subheadings, and the prose beneath becomes the issue body.

**New `TMPL-8 Template import from Google Slides`** — in §7, after TMPL-7. Body covers:
importing from a presentation's own masters/layouts when it has them; deriving a
template by analyzing slide construction when it doesn't, **consolidating near-identical
hand-built slides into a single standardized layout rather than reproducing every
variation**; capture of theme colors,
typography, element geometry, background images and logos; coercion into the
conventional layout types (TMPL-2) with descriptors synthesized for AI selection
(TMPL-6); the required whiteboard layout synthesized on import (TMPL-7); persistence of
the result as a user-owned template; and the warnings contract for anything lost.

**New `EXP-5 Lecture import from Google Slides`** — in §11, after EXP-4. Body covers:
importing a presentation's content into a new deck rendered with the template derived
per TMPL-8; per-slide layout assignment falling out of the same analysis; slot mapping
from Slides placeholders; and reuse of EXP-4's connected account for transport.

**New `EXP-6 Template export to Google Slides`** — in §11, after EXP-5. Body covers:
exporting a style template into the user's Drive as a presentation whose masters and
layouts carry the design, with a demo slide per layout; the fact that Google Slides has
no distinct template file type, so a template is expressed as a presentation's layouts;
and round-trip compatibility with TMPL-8's import.

**No new ID for template YAML import** — [EXP-3](docs/SPEC.md#L531-L533) already promises
"a user can re-import a previously exported deck **and/or template**". It is simply
unbuilt on the template side; this feature completes it. Amend its prose to state that
the template format carries layout geometry, and that an unknown reference fails rather
than silently substituting a default.

**Amend [SPEC.md:27](docs/SPEC.md#L27)** — objective 7 currently reads "export/import
(PDF, Google Slides, YAML) for **both decks and templates**". With this feature that
becomes very nearly true, so restate it precisely rather than deleting it: YAML and
Google Slides both directions for decks and templates; PDF for decks only.

**Amend `EXP-1`/`EXP-2`** — EXP-1 stays deck-scoped, but gains the Google Slides export
choice: a flat deck with baked-in formatting (the existing behavior, and the default) or
one carrying reusable layouts. It should also cross-reference EXP-6 so the template
direction is discoverable. EXP-2 should note that the template YAML format captures
layout geometry, not just descriptors.

**Amend §15 data models** — add the `Template` collection (it is currently listed as a
model but has no storage), including `renderMode`, `source`, `sourceFileId`, `assetKeys`
and `deletedLayouts`. Add `Template` to the soft-delete entity list in the §15 "Soft
delete" paragraph, and state that a **layout deleted within a template** is tombstoned the
same way and purged by the same sweep — the one place the retention model applies to a
subdocument rather than a record, so it is worth saying explicitly.

**Amend P-11** — note that the sweep deletes a purged template's stored assets, and that
asset deletion is reference-counted within the template. Also record the deliberate
omission: template assets are not metered against any storage cap.

**Amend §16/EXP-4** — note the added `presentations.readonly` scope and the one-time
reconnect it forces on already-connected instructors.

Then `npm run board:derive && npm run board:sync`.

## Doc update: `docs/TEMPLATES.md`

[docs/TEMPLATES.md](docs/TEMPLATES.md) stays the single home for how design templates
and layouts work, expanded to cover the Google Slides integration. Its path and all
inbound links from `SPEC.md`, `CONTRIBUTING.md` and `WHITEBOARD.md` are unchanged.

Sections 1–3 and 12 below already exist and need revision for the new two-store model;
sections 4–11 are new. Target shape:

1. **What a template is** — theme + layouts; the "data plus a little code" split; where
   templates live now that there are two stores (JSON built-ins and MongoDB user
   templates) and how the resolver merges them.
2. **Layouts and slots** — the conventional types (TMPL-2), the slot system and
   `SlotKind` registry, constraints and where they are enforced (prompt *and*
   `lib/slide-fit.ts`). Largely as written today; correct the stale `maxBodyLength`
   line, which no longer exists in the type or the zod schema.
3. **Layout descriptors and AI selection** — how descriptors become the GEN-6 option
   set, and why the whiteboard layout is withheld.
4. **Rendering** — the two renderer paths and the rule that picks between them:
   hand-tuned components for built-ins, the positioned renderer for any layout carrying
   `elementPositions`. Document the `ElementPosition` / `LayoutDecoration` schema and
   the normalized-coordinate and `cqi` conventions.
5. **Theme resolution** — the color keys, the new typography and background keys,
   fallbacks, and why fonts resolve to bundled stacks rather than runtime Google Fonts.
6. **Importing from Google Slides** — the four-stage pipeline; the two intents
   (template-only vs. lecture); the masters-present and inference paths; what is
   deterministic vs. what the model decides; the provider-neutral IR and what it would
   take to add a `.pptx` reader.
7. **Consolidating a hand-built deck** — the five passes, every threshold with its
   rationale and how to tune it, why median beats exemplar and tolerance beats rounding,
   and how the consolidation report reads. This is the part an operator will actually
   need to reason about when an instructor says the import got their design wrong.
8. **Exporting** — the interoperability matrix; why Google Slides has no template file
   type and a template is therefore a presentation's layouts; why export goes through
   pptx masters rather than the Slides API; the deck export's flat vs. reusable-layouts
   choice and when each is the right one; what the YAML v2 format carries and how v1
   files are still read; **[reconciled]** how slot metadata is carried through a Google
   round trip (alt-text `slot:<name>` tokens, the versioned notes payload, narration in
   speaker notes) and why a single notes blob cannot work; and how specialized content is
   rendered rather than emitted as source.
9. **Fidelity and limits** — **[reconciled]** the exported-by-us/foreign asymmetry
   (ours round-trips losslessly, a foreign deck's slots are inferred and arrive as `text`),
   that layouts and slots have no ceiling while **content kinds** are a closed list, font
   mapping, asset capture, the warnings contract, what survives a full round-trip, and what
   deliberately is not carried either way (animations, transitions, slide numbering, master
   scripting — **no longer speaker notes**).
10. **Deleting templates and layouts** — tombstone-then-purge for both, why a deleted
    layout moves to a sibling array rather than gaining a tombstone in place, how asset
    refcounting decides what the sweep actually erases, and every guard that refuses a
    deletion.
11. **Operational notes** — the `presentations.readonly` scope and reconnect,
    `IMPORT_MODE=mock|live`, `importMb` and `exports` metering, where imported assets are
    stored, and `DELETED_DATA_RETENTION_DAYS`' effect on them.
12. **Authoring a template by hand** — the existing "drop a JSON file in
    `server/config/templates/`" flow, unchanged.
13. **What's still deferred** — the doc's original "Future (TMPL-4)" section promised
    three things; this feature delivers two (storage moves to MongoDB, arrangement becomes
    data) and **[reconciled]** the extensible-slot plan delivers the third (widening
    `LayoutType`, and the slot map that lets author-named slots persist). What remains is the
    **visual editor** — now the only part of the open slot model not reachable without hand-
    editing JSON — and retiring the hand-tuned components once the positioned renderer is
    indistinguishable from them.

## Doc update: `docs/GOOGLE_API_KEYS.md`

This is the operator's setup guide, so it has to be correct before anyone can turn the
feature on. **Section 6 is already stale**: its scope table lists three scopes, but
[google-connect.ts:54](server/src/auth/google-connect.ts#L54) requests four — the
`drive.readonly` grant is undocumented. Fix that while adding the new one.

Changes:

- **Retitle §6** from "Google Forms & Drive access for quiz publishing" to cover
  connected-account access generally — it now serves quiz publishing (§17), export
  (EXP-4), and Slides import (TMPL-8/EXP-5). Same OAuth client, same refresh token,
  three consumers.
- **Enable the Google Slides API** — a new bullet in "Enable the APIs" alongside Forms
  and Drive, in the same Cloud project from §1.
- **Extend the scope table** with two rows:

  | Scope | Why |
  | --- | --- |
  | `…/auth/drive.readonly` | Browse and read presentations the user already owns — the import picker, and any Drive file the app did not itself create. **Already requested in code; previously undocumented.** |
  | `…/auth/presentations.readonly` | Read a presentation's masters, layouts, element geometry and theme to derive a template (TMPL-8). Read-only — import never writes to the user's Slides. |

- **New subsection: adding a scope forces a reconnect.** A stored refresh token carries
  only the scopes granted when it was issued, so every already-connected instructor must
  reconnect once before import works. Document that the connect URL already sends
  `include_granted_scopes=true` so reconnecting is additive rather than a downgrade, that
  the server detects the gap with a `grantedSlidesAccess` check, and that the UI prompts
  to reconnect rather than failing opaquely. This same caveat applies to any future
  scope addition, so it belongs in the doc as a general note.
- **Consent-screen implications** — `presentations.readonly` is another **sensitive**
  scope. While the consent screen is in Testing, pilot instructors must be listed as test
  users (already stated for the existing scopes). Add the part that isn't: adding a
  sensitive scope to an already-*published* external consent screen re-triggers Google
  verification, so the scope is best added before publishing, or under a Workspace-
  internal client where verification doesn't apply.
- **State plainly that no new API key is needed.** Import acts as the instructor via
  OAuth, so the ops-account keys in §§2–4 (`GEMINI_API_KEY`, the STT service account,
  `GOOGLE_CLOUD_TRANSLATION_KEY`, `GOOGLE_CLOUD_TTS_KEY`) are untouched. Worth saying
  outright — the doc's title lists keys, and a reader could reasonably assume a
  "Slides API key" exists. The only new config is `IMPORT_MODE`.
- **Add `IMPORT_MODE=mock|live`** to the §5 "Wire into the app" env block, next to
  `QUIZ_PUBLISH_MODE` and `EXPORT_MODE`, noting that `mock` needs no Google setup at all
  and is what the test suite runs under.
- **Quota note** — Slides API reads are quota'd per project; one import is a single
  `presentations.get` plus one fetch per imported asset, so the default quota is ample.
  Record it so it isn't rediscovered later.

Also update `docs/ROADMAP.md` phase scope and `server/.env.example` (`IMPORT_MODE`).

## Known fidelity limits — state these in the UI

- **[reconciled] There is no longer a seven-layout ceiling.** This plan originally deferred
  widening `LayoutType` ("TMPL-4's job, deliberately out of scope"); the extensible-slot plan
  supersedes that and widens it in `feat/TMPL-9-slot-model`, which lands **before** the
  importer. So no design is dropped because the vocabulary ran out, and this section no longer
  needs the ceiling caveat. Consolidation still merges near-identical designs deliberately —
  that is a judgment call, and it is reported.
- **[reconciled] A presentation we exported round-trips losslessly; a foreign one does not.**
  Ours carries slot metadata, so re-import restores slot names, kinds, descriptions and limits
  exactly. A deck from anywhere else has none, so every slot is inferred from geometry and
  arrives as `kind: 'text'` for the author to correct. That asymmetry is the honest statement
  of what import can promise.
- **Content kinds remain a closed list** — an imported slot can only be one of the kinds the
  app implements; a template cannot introduce a new one.
- Fonts are mapped to bundled stacks, not reproduced exactly.
- The import returns a **warnings list** — layouts dropped in coercion, assets that
  failed to download, slides whose content did not fit the mapped layout — surfaced the
  way `deck.import` already surfaces `ApiError.details`.

## Verification

1. `npm run lint && npm run format:check && npm run typecheck && npm test`
2. `npm run test:integration` (needs MongoDB)
3. `npm run build && npm run e2e`

Specific coverage to add:

- **Unit — derivation** against checked-in `presentations.get` fixtures: one deck *with*
  masters, one *without* (inference path), one pathological (single blank slide, no
  color scheme, an unmappable layout). Assert theme extraction, whiteboard synthesis, and
  that the schema validates the output. Test the LLM-failure path returns the rule-based
  fallback rather than throwing.
- **Unit — consolidation**, the densest logic in the feature and the cheapest to test
  since it is pure geometry:
  - A fixture of 12 hand-jittered "title + bullets" slides (each slot randomly offset
    within tolerance) must collapse to **exactly one** layout, with every slot's box
    inside tolerance of the seeded truth.
  - Two slides differing by just over `MERGE_TOLERANCE` must stay **separate**, guarding
    the threshold from drifting up until everything merges into one layout.
  - Chaining guard: a run of slides each 1.9% from the previous, spanning 20% overall,
    must not become one cluster — this is the single assertion that pins average-linkage
    over single-linkage.
  - A single wildly-misplaced slot must not move the median, and must appear in warnings.
  - Edge alignment: layouts seeded with left edges at 0.0812 / 0.0798 / 0.0805 must come
    out sharing one identical value.
  - Singleton handling: a one-off slide yields no layout and is reported as approximated.
  - Semantic merge: two geometrically distinct candidates given the same `type` by a
    stubbed model merge; given different types, they don't.
  - **[reconciled] Open-name resilience**: a stubbed model that returns a *novel* type name for
    every candidate must still consolidate to a sane layout count. This is the test that pins
    the preferred-vocabulary mitigation in pass 5; without it, opening `LayoutType` silently
    regresses consolidation.
- **Integration** — `template.importFromSlides` and `deck.importFromSlides` end to end,
  mocking `lib/import-google` and `token-crypto` and forcing `IMPORT_MODE: 'live'`,
  following [quiz-live.test.ts:19-65](server/test/integration/quiz-live.test.ts#L19-L65).
  Assert: `importMb` debited, 402 when the cap is exhausted, 403 without a connected
  account, the persisted template resolves for a deck view, and a public permalink can
  still read an owned template.
- **Integration — deletion and retention**, extending the existing purge-job tests:
  - `template.delete` tombstones rather than removing; the template vanishes from
    `template.list` but is still reachable with `withDeleted`.
  - `purgeExpiredSoftDeletes` past the cutoff removes the record **and** calls
    `storage.delete` for each of its assets; before the cutoff it removes neither.
  - A layout moved to `deletedLayouts` disappears from `layoutDescriptors` and the
    renderer immediately, and its orphaned assets are deleted only at the cutoff.
  - Refcounting: a logo shared by two layouts survives one of them being purged, and is
    deleted only when the last referent goes.
  - Every guard: whiteboard layout, last content layout, layout in use by live slides,
    template referenced by a live deck, and built-in templates — each rejected with an
    error naming the blocker.
- **Client** — `PositionedLayout` renders slots at their declared boxes and falls back
  cleanly on a malformed position; the built-in templates still route to their
  hand-tuned renderers (extend the existing `contract.test.tsx` invariant).
- **Round-trip** — the tests that actually prove interoperability, and the ones most
  likely to catch a silent loss:
  - *YAML*: template → YAML → import → deep-equal on theme, layouts, `elementPositions`
    and `decorations`. Plus a v1 fixture that still imports, proving version tolerance.
  - *Google Slides*: template → `.pptx` → parse the generated masters back → derive →
    compare against the original. This runs entirely offline against the pptx bytes, with
    no Drive involved, so it belongs in the unit suite and is cheap to keep green.
  - *Deck, both modes*: with `includeLayouts` off — the default — the generated pptx must
    be **byte-identical to today's output** for the same deck, which is the regression
    guard that the existing export was preserved rather than reimplemented. With it on,
    each slide must attach to the master matching its `layoutType`.
- **E2E** — in mock mode, walk: connect Google → open the picker → import a template →
  see it in the library → apply it to a deck → confirm the slide renders positioned →
  export it back to Drive. Then the lecture intent: import a deck and confirm slides
  carry mapped content.

## Suggested slicing

> **[reconciled] Superseded as an ordering.** These PRs now interleave with the
> extensible-slot plan's; the authoritative order is the **Merged sequence** table in
> [`extensible-templates-plan.md`](extensible-templates-plan.md). Two changes to what is below:
> step 0 has **landed**, and the slot model (`feat/TMPL-9-slot-model`) is inserted **before**
> PR 3 here, so the importer is written against open layout types and the slot map from the
> start. The scoping and risk notes below remain accurate and are why the PRs are shaped this
> way.

A docs-only step, then four PRs, each independently shippable and reviewable:

0. **Documentation only — landed.**
   `docs/SPEC.md`, `docs/TEMPLATES.md`, `docs/GOOGLE_API_KEYS.md`, and
   `docs/ROADMAP.md`. **No code, no config, no `.env.example`** — those wait for the PRs
   below. Markdown and `docs/` are the documented exception to the branch-and-PR rule
   (`.claude/CLAUDE.md`), so this commits directly to the default branch, and the
   requirements must exist before `board:derive` can produce the cards the PRs close.

   One caveat now that `GOOGLE_API_KEYS.md` lands here rather than with PR 3: it will
   describe a scope and an API that the code does not request until PR 3 ships. The new
   scope-table rows and the Slides API step get marked as pending that release, so an
   operator reading it today isn't misled into thinking import is available.
1. `feat/TMPL-8-template-storage` — model, async resolver, the ~8 call-site refactor,
   CRUD actions, and the deletion/retention work: soft delete, `deletedLayouts`, the
   purge-sweep entry with reference-counted asset cleanup, and the guards. No Google
   involvement; pure groundwork.
2. `feat/TMPL-8-positioned-renderer` — shared types, `PositionedLayout`, registry rule,
   theme extension.
3. `feat/TMPL-8-slides-import` — scope, `googleClientForUser`, IR reader, consolidation,
   derivation, picker, library route. The `docs/GOOGLE_API_KEYS.md` rewrite belongs here
   rather than in step 0: it tells an operator to enable an API and grant a scope the code
   does not request until this PR lands, and the reconnect prompt it describes ships with
   it.

   If this PR runs large, the consolidation passes split off cleanly as
   `feat/TMPL-8-layout-consolidation` — they take the IR in and give layouts out, touching
   no Google code, so they can land and be tested against fixtures on their own.
4. `feat/EXP-5-lecture-import` — content mapping and the lecture entry point.
5. `feat/EXP-6-template-export` — YAML v2 plus `templateFromYaml` (completing EXP-3),
   `template-pptx.ts`, `template.exportToDrive`, the `deck-pptx.ts` master upgrade, and
   the round-trip tests.

PR 1 is the riskiest despite touching no new functionality: making template resolution
async reaches into deck rendering, export, and seeding. Landing it alone, green, is
what keeps the rest of the work boring.

PR 5 can be built in parallel with 3 and 4 — it depends only on PRs 1 and 2 (storage and
the geometry types), not on anything Google-facing. It is also the fastest way to
validate the geometry model before the importer exists: hand-author one template JSON
with real `elementPositions`, export it, and open the result in Google Slides.
