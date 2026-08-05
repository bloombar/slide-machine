# Slide templates

A template is **data** (theme, layouts, slots, geometry, validation — all of it in one
place) plus, for some layouts, a small amount of **code** (a hand-tuned visual
arrangement). This page is the single home for how templates and layouts work, including
how they move to and from Google Slides.

> **Status.** Sections 1–4 describe what ships today. Template storage, the positioned
> renderer, Google Slides import/export and layout deletion (SPEC
> [TMPL-8](SPEC.md#tmpl-8-template-import-from-google-slides),
> [EXP-5](SPEC.md#exp-5-lecture-import-from-google-slides),
> [EXP-6](SPEC.md#exp-6-template-export-to-google-slides)) are specified and designed but
> **not yet built** — see [ROADMAP.md](ROADMAP.md). They are documented here because the
> design is what the implementation is checked against.

## 1. What a template is, and where it lives

Two stores, one resolver.

**Built-in templates are files.** One JSON per template in `server/config/templates/`
(`classic.json`, `midnight.json`, `seminar.json`). Drop a new `*.json` in the directory to
add one; edit a file to retune anything. No code change, no rebuild in dev. Files are
zod-validated at first use ([builtin.ts](../server/src/templates/builtin.ts)) and fail
loudly if malformed; `TEMPLATES_DIR` overrides the location; the Docker image ships
`server/config/`.

**User templates are records**, stored in MongoDB with the file schema as the document
schema — which is why the starter files use the canonical object form throughout. They are
owned, soft-deletable, shareable, and votable like any other user-owned entity.

Everything downstream asks the resolver for a template by id and does not care which store
answered. Built-ins are readable by everyone and cannot be modified or deleted; user
templates are listed and mutated only by their owner.

> **Resolution is not ownership-gated.** A deck's template is embedded in every deck view,
> including public permalinks, so *resolving* a template by id must work for anyone who can
> see the deck. Ownership gates listing and mutation, never resolution.

| Field | Meaning |
| --- | --- |
| `id`, `name` | Stable id (referenced by decks/projects) and display name. |
| `theme` | Colors, typography, background — see [§5](#5-theme-resolution). |
| `layouts` | The layout set — see [§2](#2-layouts-and-slots). |
| `renderMode` | Which renderer draws this template — see [§4](#4-rendering). |
| `source` | `builtin`, `google-slides`, or `yaml` — where it came from. |
| `assetKeys` | Stored files the template owns (backgrounds, logos), so the retention sweep can find them. |
| `deletedLayouts` | Tombstoned layouts awaiting purge — see [§10](#10-deleting-templates-and-layouts). |

## 2. Layouts and slots

Each layout carries `type`, `label`, `purpose` (**read by the AI** when choosing layouts),
`slots`, `constraints`, `elementPositions`, and optional `decorations`.

`type` is an **open name**. The conventional types (SPEC
[TMPL-2](SPEC.md#tmpl-2-conventional-layout-types)) are a preferred vocabulary to reuse
whenever one fits — shared names are what let layouts be compared and merged during import —
but a template may name a layout of its own when none of them describes the design, and a
template may declare as many layouts as it needs (SPEC
[TMPL-9](SPEC.md#tmpl-9-open-slot--layout-model)).

Every template **must** include a `whiteboard` layout — a blank slate with no slots, for
freehand drawing (WB-1). The loader rejects a template that omits it. It is withheld from
the AI's option set and never auto-selected; users add it via the layout picker.

A layout declares **any number of slots of any kind** — three code samples and two images is a
legitimate layout. Slots use the object form, the same shape the future editor authors and
MongoDB stores:

```json
{ "name": "example", "kind": "code", "label": "Worked example",
  "description": "A runnable Python snippet, at most eight lines.",
  "required": true, "maxChars": 400,
  "options": { "language": "python" },
  "style": {}, "metadata": {} }
```

`name` is the author's, and it is the key a slide stores content under. `maxChars` (and
`maxWords`) are per-slot validation that **overrides the layout-level constraint** for that
slot; `required` marks a slot the layout expects filled; `style` and `metadata` are reserved
for the visual editor. Conventional slot names (`title`, `body`, `bullets`, `image`,
`caption`) may be written as bare-string shorthand and expand from the shared defaults;
slots the author names must declare their `kind`.

### Content kinds

`kind` selects the client editor and the export renderer. Unlike slot names and layout types,
**the kind list is closed** — each kind is something the system must know how to display,
edit, fit, export and speak, so kinds are added by the project, not by users:

| Kind | Holds | Displayed as |
| --- | --- | --- |
| `text` | prose | inline markdown |
| `bullets` | a list | `<ul>`/`<ol>` |
| `image` | a picture + its own credit | `<img>` with the IMG-5 indicator |
| `code` | a program listing | monospace, syntax-highlighted per `options.language` |
| `math` | a LaTeX expression | typeset notation, never source |
| `preformatted` | text whose spacing carries meaning | monospace, spacing preserved |
| `table` | rows + optional header | a real table |

`description` is the author's **instruction to the AI** — what this slot is for, in their own
words ([§3](#3-layout-descriptors-and-ai-selection)). It is data, never a command: it is
length-capped and cannot change how the system behaves.

Layout-level `constraints` are the budget fallback, enforced both in the generation prompt
and server-side ([slide-fit.ts](../server/src/lib/slide-fit.ts)): `maxTitleChars`,
`maxBodyChars`, `maxBulletChars`, `maxCaptionChars` (characters, not words, so budgets hold
in unspaced languages like Mandarin), `maxBullets`, and `imageRequired`. Fitting respects the
kind — prose may be trimmed at a word boundary, but code and math are **never truncated
mid-token**; they are moved to another slide or omitted whole.

## 3. Layout descriptors and AI selection

`type`, `label`, `purpose`, `slots` and `constraints` together form the **descriptor** — the
machine-readable option set serialized into the generation request so the model can pick a
layout per slide (SPEC [TMPL-6](SPEC.md#tmpl-6-layout-descriptors-for-ai-selection) /
[GEN-6](SPEC.md#gen-6-ai-layout-selection)). Geometry is deliberately not sent: the model
chooses *which* layout, never *where things go*.

The `whiteboard` layout is filtered out of the descriptor set, which is the mechanism behind
"generation never selects it".

End to end:

1. Descriptors are serialized into the generation prompt — the AI picks a `type` and fills
   its slots **by name**, guided by each slot's `kind` and `description`.
2. The server enforces the budgets (slot `maxChars` over layout constraints) regardless of
   what the model returns, and discards content for slots the chosen layout does not declare.
3. The client resolves the layout renderer and each slot's editor by `kind`, with the
   template's own slot spec taking precedence over the conventional defaults.

**A template's slots are the AI's whole vocabulary.** A template that declares no `math` slot
can never produce a formula, so the template an instructor picks is what decides whether
specialized content appears at all — no separate subject setting is needed.

**The descriptor set is budgeted.** Live generation runs once per finalized phrase, so every
byte of descriptor costs latency. `description` is length-capped, self-evident conventional
slots are described tersely, and if the set has to be trimmed that is logged rather than
silently truncated.

## 4. Rendering

Two renderer paths. A template's `renderMode` decides which, and it is an **explicit
property rather than an inference**.

**`components`** — one hand-tuned React/Tailwind component per layout type (grid vs. stack,
`cqi` sizes, alignment), registered by name in
[layouts/index.tsx](../client/src/components/slide/layouts/index.tsx). This is what the
built-ins use. Unknown layout types fall back to `GenericLayout` — degraded, never blank.

**`positioned`** — a single data-driven renderer that reads `elementPositions` and places
each slot itself. This is what imported templates use, since a user cannot ship React
components.

> **Why an explicit field.** Geometry has two independent consumers: the positioned renderer
> and the pptx exporter ([§8](#8-exporting)). If rendering were keyed off "does this template
> have geometry", then giving a built-in geometry so it could export with layouts would
> silently change how it looks. One field keeps the two concerns apart.

Both implement the same `LayoutProps { slide, colors, editable, slot }` contract:
components decide *where* things go, while *what* each slot contains and *how it edits*
flows in through the `slot(name)` callback.

### The geometry schema

`elementPositions` maps a slot name to its box. Coordinates are **normalized 0–1 from the
top-left**, so a layout is resolution-independent and survives aspect changes:

```json
{ "title": { "x": 0.08, "y": 0.12, "w": 0.84, "h": 0.18,
             "align": "start", "vAlign": "center",
             "fontSize": 4.5, "fontWeight": 600, "color": "accent" } }
```

`fontSize` is in `cqi` so text scales with the slide container, matching how the hand-tuned
components size type. `color` is either a hex value or a theme key (`accent`, `muted`, …),
so a template's palette stays the single source of truth.

`decorations` holds a layout's **static, non-editable** elements — logos, rules, background
bands — as `{ kind: 'image' | 'rect', position, src?, fill? }`. They paint beneath the slots
and are never editable content.

A contract test
([contract.test.tsx](../client/src/components/slide/layouts/contract.test.tsx)) renders every
registered layout against every template file and fails if declared and rendered slot sets
differ — drift in either direction means invisible content or never-filled slots. It applies
to `components` templates, where a named component is what could drift; a `positioned`
template has no component to compare against, so it is checked against the positioned
renderer's own output instead.

**Adding a layout type** = one renderer component + one registry entry + declaring the
layout in a template file (the contract test binds them).

## 5. Theme resolution

The theme is a free-form object resolved into a known set with fallbacks
([theme.ts](../client/src/components/slide/theme.ts)):

| Key | Use |
| --- | --- |
| `background`, `surface`, `text`, `muted`, `accent` | The slide palette. |
| `penColor`, `highlighterColor` | Whiteboard defaults; fall back to `text` and `accent`. |
| `fontFamily`, `headingFontFamily` | Resolved CSS font stacks. |
| `backgroundImage` | Object-storage URL for an imported background. |

**Fonts resolve to bundled stacks, never to a runtime fetch.** An imported template records
the source font family name and maps it to the nearest available stack. Fetching a font from
a third party at display time would leak viewers to an external host on every slide view and
break offline and restricted-network use, so it is not done — the cost is that an imported
template approximates its original typeface rather than reproducing it.

## 6. Importing from Google Slides

Instructors arrive with an existing deck far more often than with a design brief, so import
is the realistic path to a template that looks like their own material (SPEC
[TMPL-8](SPEC.md#tmpl-8-template-import-from-google-slides)).

Four stages. Only the first touches Google.

```text
Google Slides ──▶ 1. read ──▶ SourcePresentation ──▶ 2. derive ──▶ template
                                                                      │
                                    ┌─────────────────────────────────┤
                                    ▼                                 ▼
                              3. persist                   4. map content → deck
                                                              (lecture import only)
```

**1. Read.** The presentation is read through the Slides API into a **provider-neutral
intermediate representation**: page size, the master's color scheme, layouts where they
exist, and per-slide elements with placeholder type, normalized box, text runs and styles,
and image references. Nothing downstream refers to a Google-shaped field, which is the seam
a PowerPoint reader would plug into later.

**2. Derive.** Geometry, colors and typography are extracted deterministically. Where the
presentation defines its own masters and layouts, those become the candidates directly;
where it does not — the common case — candidates are derived by clustering the slides, which
is [§7](#7-consolidating-a-hand-built-deck).

The **only** model call assigns semantics: given each candidate's slot composition,
positions, relative sizes and sample text lengths, it returns the conventional `type`, a
`label`, the `purpose` prose, and `constraints`. No images are sent. If the call fails or
returns something invalid, a rule-based fallback assigns types (image plus little text →
`image-heavy`; bulleted body → `list`; title alone → `section`) with canned purposes —
import degrades, it does not fail.

Background fills and recurring images are downloaded into object storage at import time,
because the source URLs are short-lived. The required `whiteboard` layout is synthesized.

**3. Persist** as a normal user-owned template with `renderMode: 'positioned'`.

**4. Map content** — lecture import only (SPEC
[EXP-5](SPEC.md#exp-5-lecture-import-from-google-slides)). Clustering has already assigned
every source slide to a derived layout, so each slide's `layoutType` is known without
guessing again. Only slot filling remains, and it is deterministic: title placeholders →
`title`; body with bulleted paragraphs → `bullets`, without → `body`; subtitle → `caption`;
the dominant image → the image slot, copied into storage. Speaker notes are not imported.

Import is **read-only** — the source presentation is never modified.

## 7. Consolidating a hand-built deck

Real decks are not cleanly templated. The same "title and bullets" slide gets rebuilt by
hand a dozen times, each copy differing by a few pixels. Reproducing every variation would
produce a template of twenty near-duplicate layouts, which is worse than useless. The
derived layout must be **tidier than any slide that produced it**.

Five passes. All deterministic except the fifth.

**1. Group by slot composition.** The coarse key is *which* slots a slide has, not where
they are. Slides with different compositions never merge, however similar their geometry.
Exact, free, and it prevents the worst mistakes.

**2. Cluster by tolerance, not by rounding.** Distance between two slides is the **maximum**
per-slot box distance `max(|Δx|, |Δy|, |Δw|, |Δh|)` — max rather than mean, so one badly
misplaced slot cannot be averaged away by three well-placed ones. Average-linkage
agglomerative clustering under `MERGE_TOLERANCE` (default 2% of the slide edge).

> Rounding into buckets is the obvious approach and is wrong: two slides differing by 0.1%
> land in different buckets whenever they straddle a boundary. Tolerance has no boundaries.
> Average-linkage rather than single-linkage because single-linkage **chains** — a run of
> slides each just under tolerance from the last would merge into one cluster spanning many
> times it.

**3. Take the median, not an exemplar.** Each slot's box is the median across the cluster. A
medoid picks one real slide and inherits its jitter; the median inherits nobody's and is
unmoved by a slide someone dragged askew. Outliers are reported, not silently absorbed.

**4. Standardize, template-wide.** Medians alone still leave a title at `x=0.0812` in one
layout and `x=0.0798` in another. So, across all derived layouts at once:

- **Align edges** — cluster every slot edge under `SNAP_TOLERANCE` and replace each with its
  cluster median, so "about 8%" becomes one shared margin and the design has a real grid.
- **Unify recurring slots** — a title landing in the same place across most layouts is
  snapped to one common box in all of them. This is the most visible cue that a deck was
  templated rather than hand-built.
- **Quantize the type scale** — cluster font sizes and snap to cluster medians, yielding a
  handful of sizes instead of a continuum.
- **Collapse near-identical colors** into the palette. Hand-built decks are full of `#1c1917`
  and `#1c1918` meaning the same thing.

**5. Semantic merge.** Only now does the model assign types. Two candidates given the **same
type** and sitting within a looser `SEMANTIC_MERGE_TOLERANCE` are merged and passes 3–4 re-run
over the union. This is what a model is genuinely better at than geometry: seeing that
title-left/image-right and title-right/image-left are both `two-column`.

> **This pass depends on the model reusing names.** Layout types are open strings
> ([§2](#2-layouts-and-slots)), so a model free to invent one per layout would merge nothing —
> silently defeating the pass that exists to stop a 40-slide deck yielding 25 layouts. The
> semantics prompt therefore presents the conventional types as a **preferred vocabulary**:
> reuse one whenever it fits, and invent a name only when none does. Merging still requires
> type equality *and* geometric similarity, exactly as before. A model that returns many novel
> names must still consolidate; that is a tested property, not an assumption.

The same call also proposes each slot's **kind** and **description**
([§2](#2-layouts-and-slots)). Geometry stays deterministic and every slot defaults to `text` —
mistaking prose for code is worse than not recognizing code — so a proposed specialized kind
is a suggestion the author corrects in the editor, never a silent reinterpretation.

**Singletons do not become layouts.** A cluster must reach `MIN_CLUSTER_SIZE`, or be
master-derived, to be emitted; a one-off slide is mapped to its nearest layout and reported
as approximated. Without this, a 40-slide deck yields 25 layouts — the failure this whole
section exists to prevent.

**Tuning.** The thresholds are module constants. Raising `MERGE_TOLERANCE` yields fewer,
looser layouts; lowering it yields more, tighter ones. When an instructor says the import
got their design wrong, this is the knob, and the consolidation report says which way to
turn it.

### The consolidation report

Consolidation is lossy, and this report is the only visibility into it — so it is a
deliverable, not a nicety. It is written in terms an instructor recognizes:

> 38 slides → 6 layouts. Merged 11 near-identical title-and-bullets slides. 2 slides did not
> match any layout and were approximated. 1 background image could not be retrieved.

## 8. Exporting

| What | YAML out | YAML in | Google Slides out | Google Slides in |
| --- | --- | --- | --- | --- |
| **Deck** | yes | yes | flat, or with reusable layouts | yes (EXP-5) |
| **Template** | yes | yes | yes (EXP-6) | yes (TMPL-8) |

### Google Slides

**Google Slides has no template file type.** A template there is just a presentation whose
layouts define a design. Exporting a template therefore means producing exactly that — our
layouts as its layouts, plus one demonstration slide each so the design is visible.

**Export goes through pptx, not the Slides API.** The Slides API cannot *create* masters or
layouts; it can only apply ones a presentation already has. So the exporter builds a `.pptx`
with one slide master per layout and lets Drive's existing pptx→Slides conversion turn those
into native Slides layouts. This also means template export needs no OAuth scope beyond the
one already used to create files.

Because the exporter writes masters and the importer reads them, export → import is a real
round-trip rather than a coincidence.

#### Carrying slot metadata

Google Slides can say where a shape sits and what text it holds, but not what a slot **is** —
its name, kind, authoring instructions or limits. So an export writes that metadata into the
presentation itself, in fields Google preserves but does not display as slide content (SPEC
[EXP-8](SPEC.md#exp-8-slot-metadata-across-google-slides-round-trips)).

**Identity travels on the shape that is the slot.** Each emitted shape carries a short
`slot:<name>` token in its alt text; the bulky part — kind, description, limits, options —
lives in a versioned payload keyed by that name. Association is therefore structural: on
import, a shape whose alt text names a slot **is** that slot, and its box becomes that slot's
geometry. Shapes with no token are decoration.

> **Why not one blob in the speaker notes.** A single blob needs a key back to each shape, and
> every candidate is bad: object ids are reassigned when a slide is duplicated and are chosen
> by Drive during conversion, so we cannot even predict what to write; placeholder types are
> too coarse to tell three code slots apart; z-order breaks on any reorder. And **notes exist
> only on slides, never on layouts** — so per-layout slot metadata, which is exactly what a
> template needs, has no home there at all.
>
> The token is kept short rather than being the whole payload because Google shows alt text to
> the user in its Alt text pane, and a wall of JSON there invites deletion.

**Speaker notes carry the narration**, which is what they mean to a presenter: a slide's
`sourceTranscript` round-trips through them.

**The metadata is written into the `.pptx`**, not applied afterwards through the Slides API —
so this needs no write scope, and the "export needs no Slides scope" property above still
holds.

**It is advisory, and untrusted.** An instructor can edit or delete alt text and notes in
Google's interface, and a converter may not preserve everything. So the payload is versioned,
validated and size-capped, and import **falls back to inference** when it is missing, damaged
or unrecognized. Its presence makes the round trip lossless; its absence degrades the result
but never fails the import.

**Deck export offers two shapes** (SPEC [EXP-1](SPEC.md#exp-1-deck-export)):

| Mode | Output | When |
| --- | --- | --- |
| Flat (default) | Slides with formatting baked in, no reusable layouts | Handing off a finished lecture — nothing to maintain |
| With layouts | Masters per layout, each slide attached to one | Continuing to work in Slides, restyling, or re-importing |

Flat is the default because it is the long-shipped, proven output; the layouts mode
restructures the file Drive then converts, so it is chosen deliberately. It requires a
template that carries geometry, so it is offered only for decks that have one.

The `whiteboard` layout has no visual design to carry. It is omitted on export and
re-synthesized on import.

### Specialized content in exports

Every export shows **what the audience saw**, not the source behind it (SPEC
[EXP-7](SPEC.md#exp-7-specialized-content-export-fidelity)). Math is typeset, never emitted as
LaTeX source — a maths lecture exported to PDF is otherwise unusable, which is the whole
reason the kind exists. Code keeps its indentation and its highlighting where the format
supports colored text, tables become real tables where the format has them and a ruled grid
where it does not, and preformatted text keeps its exact spacing. This holds for PDF and
Google Slides alike; anything a format genuinely cannot represent is named in the report.

### YAML

The YAML format is versioned and carries a template's identity, theme, layouts **and their
geometry** — not merely the descriptors, so a round-trip reconstructs the design rather than
an outline of it. It also carries every slot's name, kind, description and limits, and a
deck's YAML stores content **by slot name**, so author-defined slots survive as fully as
conventional ones. Older versions stay readable.

A **deck** import that names an unknown template falls back to a default and warns: the
content is the point and is worth recovering. A **template** import cannot do that — there is
nothing to fall back to — so it fails with an explanation rather than substituting a design
the user did not ask for.

## 9. Fidelity and limits

- **A presentation we exported round-trips losslessly**; one from anywhere else does not.
  Ours carries slot metadata ([§8](#8-exporting)), so re-import restores names, kinds,
  instructions and limits exactly. A foreign deck has none, so its slots are inferred from
  geometry and placeholder type and every slot arrives as `text` for the author to correct.
- **There is no ceiling on layouts or slots.** Layout types and slot names are open
  ([§2](#2-layouts-and-slots)), so a design is never dropped merely because the vocabulary ran
  out. Consolidation still merges near-identical designs on purpose — that is a judgment call,
  and it is reported.
- **Content kinds are a closed list.** An imported slot can only be one of the kinds in
  [§2](#2-layouts-and-slots); there is no way for a template to introduce a new one.
- **Fonts are mapped, not reproduced** ([§5](#5-theme-resolution)).
- **Carried through Google Slides:** slot metadata and narration, via the mechanism in
  [§8](#8-exporting).
- **Not carried in either direction:** animations, transitions, slide numbering, and anything
  scripted on the master.
- Everything lost is named in the report, never dropped silently.

## 10. Deleting templates and layouts

Deletion is a tombstone, and the daily retention sweep is what actually erases things (SPEC
[P-10](SPEC.md#16-privacy-security--compliance)/P-11). Templates are the first entity that
owns object-storage assets of its own, so the sweep removes **the record and its files**.

**A layout is deletable on its own** — the one place the retention model applies to part of a
record rather than a whole one. A deleted layout moves to a `deletedLayouts` array with its
own tombstone.

> **Why a sibling array rather than a tombstone in place.** Marking `layouts[]` entries
> deleted would force every consumer of that array — the descriptor set, both renderers, the
> pptx exporter — to learn to filter, and any that forgot would be a bug. Moving the entry
> out means `layouts` stays exactly what it always was and **no consumer changes**.

**Asset deletion is reference-counted.** A logo can be used by several layouts and a
background by the theme, so purging one layout must not delete a file another still needs. An
asset is removed only when nothing refers to it — no live layout, no restorable deleted
layout, and not the theme.

**Deletion is refused rather than destructive** when something depends on it. In each case
the user is told what is blocking:

- The `whiteboard` layout can never be deleted; the schema rejects a template without one.
- Neither can the last remaining content layout.
- Neither can a layout still used by live slides.
- Neither can a template still used by a live deck or project. Tombstoned decks do not block
  — they are on their way out — but a deck restored after its template was purged falls back
  to its project default, then to `classic`.
- Built-in templates cannot be deleted at all; they are files, not records.

## 11. Operational notes

- **Google Slides import needs a presentation-read scope** beyond the ones used for quiz
  publishing and export. A stored authorization carries only the scopes it was issued with,
  so already-connected instructors must **reconnect once**; the app detects the gap and
  prompts. Setup: [GOOGLE_API_KEYS.md](GOOGLE_API_KEYS.md).
- **Import has a mock mode**, as every Google-touching feature does, so the test suite and
  local development need no Google setup at all.
- **Metering**: an import counts against the import-volume allowance and its model call
  against the AI-token allowance; exports count against the export allowance
  (SPEC [BILL-3](SPEC.md#bill-3-usage-caps--metering)). Template assets are **not** metered
  against any storage cap — the retention sweep is what bounds them.
- **Imported assets** live in object storage under the template's own prefix and are listed
  in `assetKeys` so the sweep can find them without re-walking the theme and layouts.
- `DELETED_DATA_RETENTION_DAYS` governs how long a deleted template or layout — and its
  files — survive before purge.

## 12. Authoring a template by hand

Unchanged: drop a `*.json` in `server/config/templates/`. It is zod-validated at first use
and fails loudly. This remains the fastest way to add or retune a built-in, and the geometry
schema in [§4](#4-rendering) can be authored by hand too.

## 13. What's still deferred

The WYSIWYG template editor (SPEC
[TMPL-4](SPEC.md#tmpl-4-custom-templates-create--edit--save)) remains unbuilt. With storage
and the positioned renderer in place, what it still needs is:

1. **The editor itself** — a canvas for adding and arranging slots, choosing each one's kind,
   styling them, and attaching labels, instructions and validation. Import currently stands in
   as the authoring path; the editor is what lets a user fix what import got wrong, and it is
   the only remaining piece of the open slot model that is not yet reachable without editing
   a JSON file by hand.
2. **Retiring the hand-tuned components.** They are scaffolding with a planned demolition:
   convert one built-in layout to geometry, compare it side by side with its component, and
   when the data version is indistinguishable, convert the rest and delete the components.
   The registry makes this incremental — each layout type flips independently. What can never
   be deleted is the positioned renderer itself: some code must always interpret arrangement
   data.

The slide scaling strategy (container-query units) and z-index tiers are in
[DECISIONS.md](DECISIONS.md).
