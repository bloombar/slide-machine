# Slide templates

A template is **data** — theme, layouts, slots, geometry, validation, all of it in one
place. It used to be data plus a hand-written React component per layout type; those are
gone ([§4](#4-rendering)), so a layout an instructor builds and one the app ships are the
same kind of thing. This page is the single home for how templates and layouts work,
including how they move to and from Google Slides.

> **Status.** Everything here ships. Template storage, the WYSIWYG editor, layout
> deletion, the positioned renderer and export to Google Slides
> ([EXP-6](SPEC.md#exp-6-template-export-to-google-slides)) were built first; the other
> direction has since followed — deriving a template from a Google Slides presentation
> ([TMPL-8](SPEC.md#tmpl-8-template-import-from-google-slides)), re-importing a template
> from the file it was exported to ([EXP-3](SPEC.md#exp-3-round-trip-import)), and
> importing a lecture from a presentation
> ([EXP-5](SPEC.md#exp-5-lecture-import-from-google-slides)). The one source named in the
> spec and **not** built is a template from a GitHub repo, which is out of scope by
> decision — see [ROADMAP.md](ROADMAP.md).

## 1. What a template is, and where it lives

Two stores, one resolver.

**Built-in templates are files.** One JSON per template in `server/config/templates/`
(`classic.json`, `midnight.json`, `seminar.json`, `nyu-elegant.json`, `nyu-bold.json`). Drop a new `*.json` in the directory to
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

### What the model is told about a box

Above the layout menu the prompt states, once, what each **kind** in this template's layouts
holds and when to reach for it ([gemini-generation.ts](../server/src/providers/gemini-generation.ts)).
Only the kinds a template actually declares are described — telling a history template how to
write LaTeX spends the budget on a box that does not exist.

- **`text` and `bullets` are Markdown**, because that is what `SlideMarkdown` draws: `**bold**`,
  `*italic*`, backticks around an identifier or a filename, and `[label](url)` links written
  with the words a reader would click rather than a bare URL. A multi-line text box may also
  hold a `-` or `1.` list. Headings, ``` fences and `$…$` maths are refused — the renderer does
  not draw them, so they would reach the audience as their own source. A listing or a formula
  belongs in a `code` or `math` box.
- **When to reach for a box**, which is a different question from what goes in it: an
  enumeration belongs in `bullets` rather than a paragraph that lists things, something worth
  seeing belongs on a layout with an `image`, a spoken program in `code`, a spoken equation in
  `math`. A lecturer does not say "example" first; talking through the thing is the signal.
- **The layout is expected to keep changing.** `generation.txt` says so directly: a deck where
  every slide is on the same layout is one that stopped reading what was said.

The same Markdown line is carried by the post-lecture prompts (`refine`, `reformat`, `refit`),
so a later pass sharpens a slide's markup instead of flattening it.

A budget cut is repaired afterwards: clamping to `maxChars` can land inside a `**bold**` run or
a half-written link, and `closeMarkdown` in [slide-fit.ts](../server/src/lib/slide-fit.ts) drops
what the cut left open so no delimiter reaches the slide on its own. It runs only on text the
clamp actually shortened — an asterisk in prose nobody cut is arithmetic, not emphasis — and
never on a `preformatted` box, which is shown exactly as written.

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

**Every layout carries a tree by the time anything draws it**, so `FlowLayout` draws
everything. An imported design's `elementPositions` are converted into a tree of `free`
nodes on read (`adoptDefaultTree`, applied by the built-in loader, by the template model and
by the version store alike), and `rendererFor` prefers a tree over geometry. `PositionedLayout`
is the fallback for a layout that somehow has neither, and `renderMode` on a template is
vestigial — nothing reads it. Worth knowing before reasoning about imports from that file:
it looks like the import renderer and is not reached.

Two node shapes beyond a plain slot:

- A node with **no slot and no children** is decoration — a rule, band, or panel, drawn from
  its style alone. A section heading's accent bar is one.
- `before`/`after` print **literal characters** around a slot's content, which is what the
  quotation marks on a quote layout are. Neither is content, and both would have been lost
  without somewhere to put them.

A slot with nothing in it **renders nothing and takes no space**, so a container's gap does
not reserve a hole where an absent caption would go. The editor overrides that, since an
empty slot still needs to be clickable.

**A box can refuse to give way.** `shrink: 0` on a node is `flex-shrink: 0` — the box keeps
the size the design asked for, and any overflow is settled by its siblings instead. Without
it, room is taken from whichever box happens to be *able* to give it, which is how a heading
came to be crushed to make space for the list beneath it. Authored as **Holds its size** in
the slot inspector, offered only under a flex parent since `flex-shrink` is inert in a grid.

When a box genuinely cannot show what it holds, three things happen in order: the type
shrinks to fit (`useFitText`, down to 40% of the design's size), and past that floor the box
becomes a scroller rather than clipping — losing the end of a sentence with no sign it was
ever there is the one outcome worth avoiding. Only the box that actually overflows becomes
one: a scroller per slot exhausts the compositor's layer budget on a long deck, which paints
the whole list view blank.

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
[text-styles.ts](../shared/src/types/text-styles.ts) and reproduce what the built-in layouts
were written with; every built-in now **states its own scale** rather than inheriting them,
so a template's typography is visible in its file and can be taken in its own direction.

One caution for anyone writing a scale by hand or generating one: the resolution merges a
stored role over the default **field by field**, so a field a role leaves out is not left
out — it is supplied by the app's default for that role name. Omitting `fontWeight` on
`title` yields 700, and omitting `color` on `caption` yields `muted`. A role meant to be
neutral about a property must say so explicitly.

### Capitals are a setting, not the text

A box may be `caps`, and a text style may carry it for every box that follows the role. It
is a **transform applied when the box is drawn** — the slide keeps the words the author
wrote, and the box shouts them. Storing the shouted form instead would be unrecoverable: a
translation would be handed capitals to translate, a narration voice may spell them out,
search would match nothing, and every future export would carry the damage. It is the same
class of property as `fontWeight`, and it travels the same way — through the renderer, both
exporters (applied once in `deck-layout`, so the PDF and the pptx cannot disagree), the
YAML round trip and the Slides slot payload.

An import recognises it, timidly and on purpose. A box counts as set in capitals only if it
holds no lowercase letter anywhere, at least eight cased letters, and more than one word.
Wrongly shouting an instructor's body text is loud and on every slide; failing to shout a
title loses a flourish. So an acronym, a single word and a box of digits are all refused.

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
| `link` | What a hyperlink is drawn in; falls back to `accent`. |
| `imageBackground` | What is painted behind a picture. Transparent unless stated — a photograph needs nothing, but a diagram or logo with a transparent ground loses its strokes on a slide of the same value. |
| `textStyles` | Named type roles a layout's boxes refer to ([§4](#text-styles)). A role may carry `caps` (below). |
| `marginX`, `marginY`, `gap` | Authoring metrics, editor-only (below). |
| `backgroundImage` | Object-storage URL for an imported background. |

A program listing takes no theme key. It stays on a dark ground whatever the template,
because the highlighter's token colours are built for one — but it is the **template's**
darkest stated colour rather than the highlighter's own, so the block belongs to the
palette instead of looking like a screenshot of another editor (`codeSurface`,
[theme.ts](../client/src/components/slide/theme.ts)).

`textStyles` replaces the `fontFamily` / `headingFontFamily` pair this table used to
describe, which nothing ever read. A role carries a family, size, weight, slant and colour,
and a box names the role — so a template has one type scale rather than a size written on
every box.

**Fonts resolve to bundled stacks, never to a runtime fetch.** A template picks from the
short list in [fonts.ts](../client/src/components/slide/fonts.ts), and an imported one maps
the source family to the nearest available stack. Fetching a font from a third party at
display time would leak viewers to an external host on every slide view and break offline
and restricted-network use, so it is not done — the cost is that an imported template
usually approximates its original typeface rather than reproducing it.

Two faces are the exception. **Frank Ruhl Libre and Montserrat are bundled** and served from
the app's own origin, so a template naming either reproduces the typeface instead of
resembling it. Both are under the SIL Open Font License, and only the latin subsets and the
weights the templates actually set are imported. An import matches those two **by name**,
ahead of the table that answers "what does this most resemble", so a deck set in Montserrat
comes home in Montserrat; a relative that is not the face itself, like Montserrat
Alternates, still approximates.

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
presentation defines its own layouts, **each layout page becomes a layout directly** — the
layout *is* the design, and a slide is one use of it, so a hand that nudged a box on every
slide has not redesigned the layout. Where it does not — the common case — candidates are
derived by clustering the slides, which is [§7](#7-consolidating-a-hand-built-deck).

> A layout page carries the boxes and their names but its placeholders are usually **empty**,
> so it states no type size, color or font. Those are taken from the slides built on it:
> geometry from the design, styling from its uses. A layout page with no readable boxes tells
> us less than the slides do, so the deck falls back to clustering rather than importing a
> layout with nothing on it.

> A presentation is only treated as *defining* layouts when it declares more than one and its
> slides genuinely use them. Google hands every deck a `layouts` array, and a hand-built
> deck's slides all sit on one or two defaults — grouping by that would yield a single layout
> for the whole deck, which is worse than clustering.

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

**The type scale is recovered, not invented.** A presentation is rarely written to a scale
but is nearly always *set* to one — three or four sizes, used over and over. So the sizes of
every text box in the deck are clustered, the clusters are ranked, and the conventional
roles are handed out in that order ([type-scale.ts](../server/src/import/type-scale.ts)):
the size the deck gives the most **room** to becomes `body`, what sits above it is ranked
`title` / `sectionTitle` / `heading` by how widely each is used, and what sits below becomes
`caption`. Each box then names its role and states only where it disagrees with it.

Without this, an imported design of thirty layouts held a hundred private type declarations
that happened to agree — nothing wrong on screen, and nothing an instructor could edit
without visiting every box. Two consequences worth knowing:

- Sizes within 8% of one another **collapse onto one**. A title set at 40pt on most slides
  and 38pt on two of them becomes one role at the size the deck used most, which is the
  point rather than a side effect — a scale that preserved every accidental nudge would not
  be a scale.
- A role takes a colour, weight or family **only when every box following it already stated
  the same one**, so no box gains type it did not have. Where the boxes disagree, the role
  states the neutral value the box was already drawn with and the disagreeing boxes keep
  their own.

**A picture on a layout page is design; a picture on a slide is content — unless it is a
placeholder.** A deck that defines its own layouts turns each layout page into a layout
directly, so the pictures on that page are shared by every slide using it: a crest, a band,
the photograph a title treatment is built around. Read as a slide's pictures they became
empty image *slots*, and the design's own photography was fetched, stored and then
referenced by nothing. The exception is not a small one: Google's stock layouts define
picture **placeholders** on the layout page, so treating every layout-page picture as design
would make every stock picture box undeletable and leave an author no way to place an image
at all. An author can hand a decoration picture over to the slides afterwards
([§13](#13-whats-still-deferred)).

**A deck's background is the one most of its pages wear**, not the first slide's. A title
slide is the page least like the rest — an official template deck opens on its brand colour
and is white for most of what follows — and the theme's palette is chosen for legibility
against that background, so reading it off the first slide can collapse `text`, `muted` and
`accent` onto a single colour.

**Ceilings are measured, not guessed.** Each layout's `constraints` — how many bullets, how
long a title — are the **largest actually observed** across the slides that used it, because
what an author did is better evidence than what a box could have fitted. They reach the AI
through the layout descriptor ([TMPL-6](SPEC.md#tmpl-6-layout-descriptors-for-ai-selection)),
so generated slides sit in the design instead of overflowing it. Taking the largest means no
existing slide is retroactively over its own limit.

**Backgrounds and logos come with the design.** A page filled with a picture, a band or rule
drawn behind the content, and a logo that appears in the same place on every slide of a design
all become the layout's `decoration` — painted behind every slot, never editable, never
generated into, never read aloud. Consolidation is what tells a **logo from a figure**: a
picture that repeats identically across a design is decoration, one that changes per slide is
content and stays a box the author fills.

Every such picture is fetched into the template's own storage at import time and the layout
points at that copy, because a presentation's image URLs are short-lived — a template that
merely remembered them would look right for an hour and then be full of holes. One that cannot
be retrieved is **left out rather than pointed at**, and counted in the report.

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

### Importing a template file

A design also travels as the file it was exported to (SPEC
[EXP-3](SPEC.md#exp-3-round-trip-import)). `template.import` takes the YAML
`template.export` writes and recreates it as a new template in the caller's library;
`template.importFromDrive` is the same import reading the file out of the connected Drive
by pasted link, since EXP-3 allows an upload **or** a connected account. Once the bytes
are in hand both take the same path, so neither route can drift into accepting what the
other refuses.

Two behaviours are worth knowing, because they differ from a **deck** import:

- **It refuses rather than substitutes.** A deck naming an unknown template falls back to
  the default and warns — the lecture's content is still worth recovering. A template has
  nothing to fall back to, so a malformed file, a deck export, or a decoration picture that
  cannot be retrieved refuses the whole import and lists why. Nothing is written until
  every picture is stored, so a refusal leaves nothing behind.
- **The pictures become the importer's own.** Decoration names files under the exporting
  template's prefix; pointing at those would make one library's design depend on another's
  and would be swept as theirs rather than the importer's
  ([P-11](SPEC.md#16-privacy-security--compliance)). Each is re-stored under the new
  template's prefix first.

The file's `id` and `visibility` are read and discarded: an import is a new template owned
by whoever imported it, and it arrives private, the same judgement the Google Slides import
makes. The `whiteboard` layout is synthesized when a file has none.

**4. Map content** — lecture import only (SPEC
[EXP-5](SPEC.md#exp-5-lecture-import-from-google-slides)), via `deck.importFromSlides`.
Clustering has already assigned every source slide to a derived layout, so each slide's
`layoutType` is known without guessing again — it is never re-decided, which would be a
second chance to disagree with the design just built.

Only slot filling remains, and it is deterministic rather than a model call: the slide
already says what it holds, and asking a model would be slower, cost money, and be
occasionally wrong about a question the presentation has already answered. A box of
bulleted paragraphs becomes `bullets`, prose becomes `text`, a table becomes its rows, and
a picture is pointed at the copy the import stored — so the lecture does not depend on the
Google file continuing to exist. Where a box carries its own declaration (an export of
ours, [EXP-8](SPEC.md#exp-8-slot-metadata-across-google-slides-round-trips)) that wins over
every inference: a box exported as `code` holds a listing though nothing about the shape
says so, and its indentation is kept because indentation is content.

A picture that could not be retrieved is **named in the report** rather than written as a
reference to nothing, and the report numbers slides as the deck presents them — "slide 4:
image" is something an author can act on where "3 boxes dropped" is not.

**Speaker notes become narration only on an export of ours**, which wrote them from
narration in the first place. Another deck's notes may be reminders or citations, and
narration is read aloud ([PLAY-2](SPEC.md#play-2-narration-playback)), so they are left
where they are.

One read produces **both** a lecture and the style template its design became; the template
is saved to the author's library either way, since EXP-5 lets them keep only that.

**A lecture import always keeps every slide**, and offers no choice about it — a deliberate
divergence from EXP-5's "derived into a style template exactly as
[TMPL-8](SPEC.md#tmpl-8-template-import-from-google-slides) describes", which consolidates.
Consolidation is what makes a *template* usable: a handful of designs to choose between
rather than forty near-identical ones, each described identically to the AI. A lecture is
the deck itself, and merging two slides that were drawn differently redraws one of them.
The instructor asked for their lecture, not a tidied version of it. The design import keeps
the choice, since that is where the judgement belongs.

Import is **read-only** — the source presentation is never modified.

## 7. Consolidating a hand-built deck

**Consolidation is off by default.** An import keeps each slide's design as its own layout
unless the author ticks the box asking for merging — `KEEP_EVERY_SLIDE_BY_DEFAULT` in
`shared`, read by both action schemas and by the control's own initial state so the two
cannot disagree. Which slides are "the same design" is a judgement, and a judgement made
silently is one the author cannot see being made: a deck comes back with fewer layouts than
it had slides and nothing says which were merged into which.

Worth stating plainly because the two branches produce genuinely different templates —
merging takes the median type size across the slides it combines, so a deck's display sizes
collapse toward its commonest one. Anything reasoning about, testing, or reproducing an
import must run the branch the app actually sends, which is this one.

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
or unrecognized. Its presence makes the round trip much better; its absence degrades the result
but never fails the import. Better, not lossless — see [§9](#9-fidelity-and-limits) for
what it does not carry.

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

- **A presentation we exported round-trips better than a foreign one, not losslessly.**
  Ours carries slot metadata ([§8](#8-exporting)), so re-import restores names, kinds,
  instructions, limits and the text ROLE each box follows. A foreign deck has none, so its
  slots are inferred from geometry and placeholder type and every slot arrives as `text`
  for the author to correct.
- **A design's typography does not survive the trip.** The payload carries which role a box
  follows; nothing carries what each role IS. Every shape is exported in resolved type, so a
  re-import derives a fresh scale from the letterforms rather than restoring the one that
  left — and a fresh scale clusters differently. Measured on a real deck: 20 of 31 boxes
  came back resolving to different type, including **eight titles that lost their capitals**
  because they inherited `caps` from a role rather than stating it themselves. Sizes drift a
  few percent and nobody notices; the capitals are visible. Carrying role definitions
  alongside the references is what fixes it, and it is not done yet.
- **There is no ceiling on layouts or slots.** Layout types and slot names are open
  ([§2](#2-layouts-and-slots)), so a design is never dropped merely because the vocabulary ran
  out. Consolidation still merges near-identical designs on purpose — that is a judgment call,
  and it is reported.
- **Content kinds are a closed list.** An imported slot can only be one of the kinds in
  [§2](#2-layouts-and-slots); there is no way for a template to introduce a new one.
- **A box's height is over-budgeted, in two ways still outstanding.** Both make the
  importer ask for more room than a design gave, and `build-template` then GROWS the box
  until its content fits — so both move shipped geometry, not only budgets.
  - **Google's text insets are not modelled.** Slides draws text inside a default inset of
    0.1in left and right, 0.05in top and bottom (measured at 0.085–0.096in across three
    cases); `capacityOf` divides the full box width and knows nothing about it. That is 4.2%
    of usable width on a 0.471-wide title box and **8.0% on a 0.251-wide caption**, which is
    why NYU Bold's slide 7 captions ship at 0.355 where NYU drew them at 0.231 — the clearest
    evidence that this reaches geometry. It is also why "TEMPLATE NOTES" wraps to two lines
    in Google and one in our estimate. **The API exposes no inset field** — `leftInset` and
    its siblings appear nowhere in a captured deck — so it can only be applied as Google's
    documented default; do not go looking for it in the response. Note also that the fix is
    not the character-width constant, which was measured and is right: Montserrat's caps
    advance is 0.684 em/char and `montserrat: 0.637` sits correctly inside the range for
    realistically spaced titles.
  - **One line is budgeted as a full line box.** `fontSize × lineHeight` overstates the ink
    of a single line of display capitals, which have no descenders and sit well inside their
    line box. A designer sizing a box to the cap height of one line — as NYU did for the
    `big-number` figure, 0.377 high for type whose line box is 0.443 — will always have that
    box grown by us.
  Fixing either in the budget alone would make the arithmetic describe GOOGLE's usable area
  while our renderers still draw to the box edge. The fix is to derive real `padding` on the
  imported box: the positioned renderer honours it already (`boxStyle.surfaceStyle`), so what
  is missing is the derivation, padding-aware capacity arithmetic, and inset text in
  `deck-layout` and both exporters, which today ignore it.
- **Design furniture the layout model cannot express.** Three instances, found in one
  deck, none of them fixable in a template file — they need the model to change, and they
  are listed together because a fix for any one of them leaves the others looking fixed.
  - **Decoration cannot sit above a slot.** `PositionedLayout` and `FlowLayout` paint every
    decoration piece and then every slot, so a rule, band or logo the design draws OVER a
    picture is painted under it and disappears. NYU Bold's seam rule straddles the left edge
    of its photograph exactly as Google draws it, and half of it is behind the picture; the
    shipped file moves that one rule aside as an authored departure, which fixes the design
    and not the class.
  - **Decoration cannot hold text, and text on a LAYOUT page is not carried down.** The
    same symptom by two different routes, so both are named: a text box on a SLIDE is
    dropped by consolidation (NYU Bold's part number), and a text box on a LAYOUT page is
    dropped by `inheritedDecoration`, which carries pictures and fills down the chain and
    not text (its opening quotation mark). Neither is content — an ornament offered as a
    fillable box puts a quotation mark in front of an author as something to write in — so
    the model needs decoration that can be typographic, not a new slot.
  - **A box may overlap another while its ink does not.** NYU's part-number slide has a
    full-width title box and a 250pt numeral over its right half. It reads because the
    title's ink never reaches that half — but the audit sees two boxes of words on top of
    each other and is right to, since nothing in the data distinguishes this from the
    defect. Narrowing the title box is not available either: at ~7 characters a line the
    deck's own title would not fit in three lines.
- **A layout the source deck has no slide for is an addition, not a derivation.** The
  eleven conventional types are always present ([§2](#2-layouts-and-slots)), so importing a
  design that shows no code, no formula and no table still produces boxes for them, drawn to
  the design's margins and set in its type — but nothing about how they look was observed.
  NYU Bold is the case: its `code` panel is the only dark object in a design of white
  grounds, purple grounds and photographs. It ships dark deliberately. The colour is not
  invented — `codeSurface` resolves it to `#333333`, the deck's own body ink — and a listing
  needs a ground that separates it from the page, where the only pale alternative
  (`surface`, `#f3f3f3`) reads against white as a rendering fault rather than a panel. The
  reservation stands on its own terms: with no source slide there is nothing to be faithful
  TO, so this is a judgment about legibility wearing a design's colours, and it is recorded
  here rather than left to look derived. `codeSurface` is shared client code, so the
  alternative was never a template decision — it would change every design at once.
- **A formula is set in KaTeX's face, not the design's.** `MathTypeset` imports
  `katex.min.css`, which brings Computer Modern with it, so every equation in every
  design is serif and italic whatever the deck's own typography says. Sharper than the
  code panel above and worth reading as a different kind of problem: the panel is a
  judgment about a layout with no source, while this is one design's letterforms
  appearing inside another's, visible to a reader who knows nothing about the deck.
  NYU Bold has no serif on any of its thirteen slides. Mapping the notation onto the
  theme's own family is not a template setting — it is the same system-level change as
  the code panel's ground, and it moves all five built-ins at once.
- **A character's width is measured at one weight and used at every weight.**
  `CHAR_W` in `text-metrics.ts` holds one number per face, taken from prose at weight
  400, and a display title is nearly always bold. Measured in the browser in the app's
  own bundled faces: Montserrat is 5.4% wider at 700 than at 400 in prose and 2.6%
  wider in capitals; the spread across faces is 1.8% (humanist) to 20% (geometric), and
  0% for a monospaced face where every glyph is one advance whatever the weight. So a
  single bold multiplier is as wrong as a single character width was.

  Not fixed here, and the reason is worth recording. A per-face, per-weight table can
  only be measured for the faces the app bundles — the rest name whatever generic the
  reader's machine supplies, so a number measured on one machine describes that
  machine. And the correction interacts with `WRAP_ALLOWANCE`: applying it made NYU's
  own two-line title stop fitting, because the allowance charges three characters for a
  break that in that title costs one — the space the break consumes is counted against
  the budget and then again as raggedness. Two approximations that only agree by
  accident, which is why the one box where it showed (`big-number`'s figure, the only
  box at display size) states its own budget instead. The constant behind it has never
  been validated in a browser at any weight.
- **Fonts are mapped, not reproduced** ([§5](#5-theme-resolution)).
- **Carried through Google Slides:** slot metadata and narration, via the mechanism in
  [§8](#8-exporting).
- **Not carried in either direction:** animations, transitions, slide numbering, and anything
  scripted on the master.
- Everything lost is named in the report, never dropped silently.

### Checking an import

Derived from doing it twice and finding most of it the hard way. The order matters:
each step is cheap, and each one gates the next.

1. **Record which code path produced the template** — the options the product sends,
   not a script's defaults. Everything below describes whatever this produced, and an
   import run with different options is a template no instructor will ever receive.
2. **Read the source deck before looking at the import.** Count its slides, its
   pictures *through layout inheritance* (a deck often keeps them on layout pages,
   not slides), its all-caps strings, its distinct type sizes and colours.
   Expectations have to come from the source, before the import can anchor you to
   its own numbers: you cannot notice that six type roles arrived as two unless you
   knew there were six.
3. **Audit the template's data** (`npx tsx scripts/audit-template.mjs <file>`):
   palette collapse, boxes too small to hold text, text over text, styles nothing
   defines, unreadable contrast. Seconds, no browser. *It cannot see wrapping, and
   it cannot see whether any of this matches the deck.*
4. **Compare those counts against step 2.** Roles against type steps; pictures
   referenced against pictures present; capitalised boxes against capitalised
   strings; layouts against slides. This is the step that catches a feature that
   never ran, and no passing test will tell you: a zero here means nothing happened.
5. **Confirm the build, and know which tests a green actually ran.** The e2e suite
   runs the built app, so a bundle older than the change under test can only answer
   questions about a different program — check the bundle contains something the
   change introduced. And check what a passing run covered: the local gate in
   [CONTRIBUTING](CONTRIBUTING.md) is `npm test`, which is unit tests only, while CI
   also runs `test:integration` and the e2e suite. A green from the first says
   nothing about the other two, and "the tests passed" is the most-repeated sentence
   in software.
6. **Render every layout, with content written to strain it** — an unbreakable word,
   a URL, a list past its point count (`e2e/tests/imported-template-fidelity.spec.ts`,
   `nyu-bold-comparison.spec.ts`). *These only see boxes that were given content.*
7. **Look at it beside the source.** The only step that catches a colour read wrong,
   and nothing asserted substitutes for it.
8. **Round-trip it and compare box by box, paired by slide** — never by layout name,
   which is assigned fresh on every import, so the same name means different slides.

Two questions to carry through all of it:

- **What would this number look like if the thing that sets it had never happened?**
  If the answer is "the same", it is not evidence. A count of zero failures, a field
  that does not exist on the type being read, and a measurement that never ran all
  report exactly what success reports.
- **Does this pass mean "nothing broke" or "the thing works"?** They are
  indistinguishable from outside, and a green suite proves nothing about a feature
  absent from the design under test.

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

**Storage is per-process, and the e2e server has its own.** An import writes a template's
pictures under `STORAGE_LOCAL_DIR`, which is relative to the working directory: the app
serving from `server/` writes `server/.uploads`, while the e2e harness runs from `e2e/` and
writes `e2e/.uploads-e2e`. A template imported by one is therefore missing its pictures to
the other, and the symptom is decoration that silently does not render rather than an error.
Check with a direct request for the file, not by looking at the slide.

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

**Import is done, in both directions.** This section used to list it as outstanding and no
longer should: a template from a Google Slides presentation
([TMPL-8](SPEC.md#tmpl-8-template-import-from-google-slides)), a lecture from one
([EXP-5](SPEC.md#exp-5-lecture-import-from-google-slides)), and a template re-imported from
its own YAML export ([EXP-3](SPEC.md#exp-3-round-trip-import)) have all landed — [§6](#6-importing-from-google-slides)
and [§7](#7-consolidating-a-hand-built-deck) describe them. The WYSIWYG editor
([TMPL-4](SPEC.md#tmpl-4-custom-templates-create--edit--save)) is the authoring path, and the
per-type layout components it replaced are gone: every layout is data now, drawn by
`FlowLayout`.

What is genuinely outstanding is **authorability** rather than capability — parts of the
model that render, export and import correctly but that the editor gives an author no way to
reach:

1. **Picture decoration cannot be CREATED in the editor.** A layout's `decoration[]` — a
   band, a logo, a full-bleed background — draws in both renderers and survives every round
   trip, but only an import or a hand-written JSON file can produce one. In the editor an
   author can style an empty tree node into a rule or a panel, and can go no further.

   What an author *can* now do is **open one up**: layout settings lists the pictures a
   design paints and turns any of them into an image slot at the same rectangle, so a
   photograph a title treatment was built around becomes something a lecture fills with its
   own. Reversed by undo, like any other edit. The remaining gap is the other direction —
   bringing a new picture in as decoration, which still wants an upload the editor has no
   route for.
2. **A user-created template has nowhere to put a picture.** `/templates` serves the
   built-ins' assets out of the repo, and an import stores its own under the template's
   prefix in object storage. A template authored in the app has neither route.
3. **Deriving the rest of a design's theme on import.** The type scale is recovered now
   ([§6](#6-importing-from-google-slides)); `marginX` / `marginY` / `gap` and
   `imageBackground` are not, so an imported template still states no authoring metrics.

The slide scaling strategy (container-query units) and z-index tiers are in
[DECISIONS.md](DECISIONS.md).
