# Slide templates

A template is **data** — theme, layouts, slots, geometry, validation, all of it in one
place. It used to be data plus a hand-written React component per layout type; those are
gone ([§4](#4-rendering)), so a layout an instructor builds and one the app ships are the
same kind of thing. This page is the single home for how templates and layouts work,
including how they move to and from Google Slides.

> **Status.** Everything here ships except **import**. Template storage, the WYSIWYG
> editor, layout deletion, the positioned renderer and export to Google Slides
> ([EXP-6](SPEC.md#exp-6-template-export-to-google-slides)) are all built. What is
> specified and designed but **not yet built** is the other direction: deriving a
> template from a Google Slides presentation
> ([TMPL-8](SPEC.md#tmpl-8-template-import-from-google-slides)) and importing a lecture
> from one ([EXP-5](SPEC.md#exp-5-lecture-import-from-google-slides)) — see
> [ROADMAP.md](ROADMAP.md). Those are documented here because the design is what the
> implementation will be checked against.

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

**A template has a page of its own**, at `/t/:permalinkSlug` — the same shape as a deck's
`/d/:slug`. That page is the editor for its author and the design itself (each layout as a
rendered slide) for anyone else who may read it; `template.get` serves it, applying the
template's visibility. A built-in's slug is its id. A stored one gets a readable slug when
it is created and keeps it through renames, so a link to a design stays good; templates
predating permalinks read as their document id until their next save, which backfills one.

| Field | Meaning |
| --- | --- |
| `id`, `name` | Stable id (referenced by decks/projects) and display name. |
| `permalinkSlug` | Where the template's own page lives: `/t/:permalinkSlug`. |
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

### Where a slot's content lives

The conventional slots have fields of their own on a slide (`title`, `body`, `bullets`,
`imageRef`, `caption`). A slot the author named has no such field, so its content is stored
under its `name` in `slide.slotContent`:

```json
{ "slotContent": { "photo-2": { "imageRef": "https://…/b.png", "imageSource": "seeded" },
                   "note": { "text": "Read chapter 4" } } }
```

Edits address it the same way — `slide.editContent` takes a `slots` map and merges one slot
at a time, so filling one box never clears another — and an image upload names its box
(`POST /api/slides/:id/image` with a `slot` field). This is what lets one layout hold four
pictures: four image slots, four names, four boxes.

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

**A layout is data, not code.** It carries a `tree` — containers and boxes — and
[FlowLayout](../client/src/components/slide/layouts/FlowLayout.tsx) draws it. There used to be
a hand-written React component per layout type; those are gone, so a layout an instructor
builds in the editor and one the app ships are the same kind of thing, and nothing an author
can make is second class.

Two renderers remain beside it, and both are fallbacks rather than alternatives:

| Renderer | When |
| --- | --- |
| `FlowLayout` | The layout has a `tree`. Everything, now. |
| `PositionedLayout` | Geometry but no tree — a design imported from Google Slides ([§6](#6-importing-from-google-slides)) |
| `GenericLayout` | Neither. Stacks whatever the slide holds: degraded, never blank. |

`rendererFor` checks the whiteboard first and never lets it fall through: it is a blank slate
by definition (WB-1), and the generic fallback would offer an editor for content it must
never hold.

> **`renderMode` is now vestigial.** It existed to keep "has geometry" from meaning "draw
> from geometry", back when giving a built-in boxes purely to improve its PDF would have
> redesigned it on screen. Every layout carries a tree and geometry is derived from it, so
> the ambiguity is gone. The field stays because it is persisted on existing templates and
> removing it would be a migration for no gain.

### The tree

```ts
{ id, container: { mode: 'flex' | 'grid' | 'free', direction, gap, columns, justify, alignItems },
  children: [ { id, slot, style, grow, colSpan, box } ] }
```

A node's **placement is decided by its parent's container**: children of a flex or grid
container carry flow sizing (`grow`, `basis`, `colSpan`), children of a `free` one carry an
absolute `box`. One rule, so the two models live in one tree without a tagged union at every
level.

`free` is first-class rather than a legacy path — a design imported from Google Slides arrives
as absolute geometry with no flow to fall back on.

Two node shapes beyond a plain slot:

- A node with **no slot and no children** is decoration — a rule, band, or panel, drawn from
  its style alone. A section heading's accent bar is one.
- `before`/`after` print **literal characters** around a slot's content, which is what the
  quotation marks on a quote layout are. Neither is content, and both would have been lost
  without somewhere to put them.

A slot with nothing in it **renders nothing and takes no space**, so a container's gap does
not reserve a hole where an absent caption would go. The editor overrides that, since an
empty slot still needs to be clickable.

### Sizes are `cqi` or fractions, never `px`

`gap`, `padding`, `radius`, `borderWidth` and `fontSize` are in `cqi` — a percent of the
slide's **width** — so type and spacing scale with the slide rather than the window, and
`deck-layout.ts` converts back by dividing by 100. Boxes, `basis`, `width` and `height` are
fractions of their container, 0–1. Anything in `px` or `rem` would stop scaling and land
wrong in a PDF.

**Tailwind cannot see an interpolated class.** `grid-cols-${n}` and `gap-[${v}cqi]` compile in
dev and vanish from a production build, so `FlowLayout` maps every fixed choice through a
literal lookup and emits everything numeric as an inline style.

### Text styles

A box names a role — `heading`, `body`, `caption` — and the template's `theme.textStyles`
decides what that means, with any field the box sets itself overriding it. Changing "body"
restyles every body box in every layout, instead of sending an author round eight tabs to
make the same edit. Defaults are in
[theme.ts](../client/src/components/slide/theme.ts) and reproduce what the built-in layouts
were written with.

### How much a box holds

A text style also carries a **budget** — roughly how many characters fit a box
set in it, and for a list how many points. It is what the model is told a box
holds and what `slide-fit.ts` trims to, so generation and rendering work to the
same number rather than each to their own.

Resolution runs box → style → nothing: a slot's own `maxChars`/`maxItems` wins,
else the style it follows, else no limit. `layoutDescriptors` does that
resolution, so the prompt sees the effective figure whether or not the box
states one.

This is why the budget lives on the style rather than only on the box: a
layout an author builds inherits sensible limits from the moment it exists,
instead of leaving the model to guess how much text belongs on a slide it has
never seen.

### The geometry schema

`elementPositions` maps a slot name to its box, **normalized 0–1 from the top-left**:

```json
{ "title": { "x": 0.08, "y": 0.12, "w": 0.84, "h": 0.18,
             "align": "start", "vAlign": "center",
             "fontSize": 4.5, "fontWeight": 600, "color": "accent" } }
```

It is now **derived from the tree**, not authored: on save the editor measures what the
browser drew and writes the result here. That is because its readers cannot run CSS — the
PDF, pptx and Slides exporters ([§8](#8-exporting)), and any future non-browser consumer. A
slide is always 16:9 and every size is a fraction or a `cqi`, so a layout measured at any
width normalizes to the same numbers. A layout whose tab was never opened keeps the geometry
it had rather than losing it.

`decorations` holds a layout's **static, non-editable** elements — logos, rules, background
bands — as `{ kind: 'image' | 'rect', position, src?, fill? }`. Simple rules and panels are
covered by decoration nodes in the tree; this remains specified for images.

Three tests bind the halves together:

- [contract.test.tsx](../client/src/components/slide/layouts/contract.test.tsx) — every tree
  shows exactly the slots its layout declares. Drift in either direction means invisible
  content or never-filled slots.
- [migration.test.tsx](../client/src/components/slide/layouts/migration.test.tsx) — each
  built-in tree still emits the CSS its old component did, class for class.
- [builtin-layouts.spec.ts](../e2e/tests/builtin-layouts.spec.ts) — and still puts the boxes
  in the same places, measured in a real browser. jsdom lays nothing out, so the unit tests
  prove the CSS and only this proves the pixels.

**Adding a layout type** = declaring it in a template file with a tree. No component, no
registry entry.

## 5. Theme resolution

The theme is a free-form object resolved into a known set with fallbacks
([theme.ts](../client/src/components/slide/theme.ts)):

| Key | Use |
| --- | --- |
| `background`, `surface`, `text`, `muted`, `accent` | The slide palette. |
| `penColor`, `highlighterColor` | Whiteboard defaults; fall back to `text` and `accent`. |
| `textStyles` | Named type roles a layout's boxes refer to ([§4](#text-styles)). |
| `marginX`, `marginY`, `gap` | Authoring metrics, editor-only (below). |
| `backgroundImage` | Object-storage URL for an imported background. |

`textStyles` replaces the `fontFamily` / `headingFontFamily` pair this table used to
describe, which nothing ever read. A role carries a family, size, weight, slant and colour,
and a box names the role — so a template has one type scale rather than a size written on
every box.

**Fonts resolve to bundled stacks, never to a runtime fetch.** A template picks from the
short list in [fonts.ts](../client/src/components/slide/fonts.ts), and an imported one records
the source family name and maps it to the nearest available stack. Fetching a font from a
third party at display time would leak viewers to an external host on every slide view and
break offline and restricted-network use, so it is not done — the cost is that an imported
template approximates its original typeface rather than reproducing it.

**The metrics are an authoring aid and nothing else.** The editor draws them as guidelines and
snaps dragged boxes to them; no renderer reads them. That is deliberate: changing a margin
must not move a slide in a lecture someone already gave.

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
presentation defines its own masters and layouts, those become the candidates directly —
its author's grouping beats any clustering of ours; where it does not — the common case —
candidates are derived by clustering the slides, which is
[§7](#7-consolidating-a-hand-built-deck).

> A presentation is only treated as *defining* layouts when its slides genuinely use more
> than one and each group agrees on which boxes it has. Google hands every deck a `layouts`
> array, and a hand-built deck's slides all sit on one or two defaults — grouping by that
> would yield a single layout for the whole deck, which is worse than clustering.

The **only** model call assigns semantics: given each candidate's slot composition,
positions and relative sizes, it returns the conventional `type`, the `purpose` prose, and a
sentence per slot. **Names and sentences only — never geometry**, so a wrong answer can
mislabel a layout but never produce one that draws incorrectly. No images and no slide text
are sent. If the call fails, is unconfigured, or returns something invalid, a rule-based
fallback assigns types (image alone → `image-heavy`; boxes side by side → `two-column`;
bulleted body → `list`; a heading low on the page → `section`; otherwise `content`) — import
degrades, it does not fail.

**A presentation this system exported is restored, not inferred.** Where a page carries slot
metadata ([EXP-8](SPEC.md#exp-8-slot-metadata-across-google-slides-round-trips)), each box's
kind, label, instruction and limits come back verbatim — a code box holding a listing is
indistinguishable from prose on the slide, so being told is the only way to know. Everything
else is inferred, and that direction stays lossy.

**Fonts are mapped, never fetched.** A typeface name is matched to one of the app's own font
stacks by the property that survives the mapping — serif, monospaced, geometric, humanist,
or neither. Reproducing the original exactly would mean a request to a font host on every
slide view ([§5](#5-typography)).

Background fills and recurring images are downloaded into object storage at import time,
because the source URLs are short-lived. The required `whiteboard` layout is synthesized.

**3. Persist** as a normal user-owned template with `renderMode: 'positioned'` — private,
renamable, and applied to nothing. An import is a good guess and still a guess, so what it
produces is a starting point its author reviews, never a change to a lecture.

The action is `template.importFromSlides`, reached from the Design tab of a lecture's or
project's settings: the instructor pastes the presentation's link and the id is read out of
it. It is metered against the **import** allowance
(SPEC [BILL-3](SPEC.md#bill-3-usage-caps--metering)), and needs no Google scope beyond the
one already used to browse Drive ([§11](#11-operational-notes)). Like every Google-touching
feature it has a **mock mode**, which reads a deliberately messy sample deck — three designs
rebuilt by hand with jitter, plus one slide like nothing else in it — so the whole
consolidation runs in tests and on a machine with no credentials.

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

- **Google Slides import needs no new OAuth scope, and nobody has to reconnect.** This note
  previously said the opposite; a live check against the Slides API settled it. The `drive.readonly`
  already granted for the folder picker is enough for `presentations.get`, so an instructor
  connected for quiz publishing or export can import immediately. The reader still handles a
  403/401 by asking for a reconnect rather than assuming — a file shared without the right
  access produces the same status, and that case is real even when the scopes are fine.
  Setup: [GOOGLE_API_KEYS.md](GOOGLE_API_KEYS.md).
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

**Import, in both directions.** Everything else in this document is built — the WYSIWYG
editor ([TMPL-4](SPEC.md#tmpl-4-custom-templates-create--edit--save)) is the authoring path,
and the per-type layout components it was meant to replace are gone: every layout is data
now, drawn by `FlowLayout`. What remains:

1. **A template from a Google Slides presentation**
   ([TMPL-8](SPEC.md#tmpl-8-template-import-from-google-slides)) — the reason
   `PositionedLayout` and `elementPositions` exist, since an imported design arrives as
   absolute geometry with no tree. Export already goes the other way.
2. **A lecture from a Google Slides presentation**
   ([EXP-5](SPEC.md#exp-5-lecture-import-from-google-slides)).
3. **Re-importing a template from its own export** — a template downloads as YAML and
   exports to Slides, but neither comes back ([EXP-3](SPEC.md#exp-3-round-trip-import) on
   the template side; decks already round-trip through YAML).

The slide scaling strategy (container-query units) and z-index tiers are in
[DECISIONS.md](DECISIONS.md).
