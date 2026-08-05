# Slide templates

A template is **data** (theme, layouts, slots, validation — all of it in
one place) plus, for now, a small amount of **code** (the visual
arrangement of each layout). This page documents how that works today
and what remains before the arrangement is data too.

Templates come from two places and behave identically once loaded: the
JSON files a deployment ships, and the ones users author
([TMPL-4](SPEC.md#tmpl-4-custom-templates-create--edit--save)), stored in
MongoDB. Everything downstream resolves a template by id through
[`templates/resolve.ts`](../server/src/templates/resolve.ts) and never
learns which store it came from.

## How it works today

### The data: `server/config/templates/`

One JSON file per template (`classic.json`, `midnight.json`,
`seminar.json`) — the **single home of all externalized template data**.
Drop a new `*.json` in the directory to add a template; edit a file to
retune anything. No code change, no rebuild in dev. Files are
zod-validated at first use ([builtin.ts](../server/src/templates/builtin.ts))
and fail loudly if malformed; `TEMPLATES_DIR` overrides the location; the
Docker image ships `server/config/`.

| Field | Meaning |
| --- | --- |
| `id`, `name` | Stable id (referenced by decks/projects) and display name. |
| `theme` | Renderer colors: `background`, `surface`, `text`, `muted`, `accent`. |
| `layouts` | The layout set. Each layout: `type` (one of the conventional types, SPEC [TMPL-2](SPEC.md#tmpl-2-conventional-layout-types)), `label`, `purpose` (**read by the AI** when choosing layouts), `slots`, `constraints`, `elementPositions` (reserved — see the future section). Every template **must** include a `whiteboard` layout — a blank slate (no slots) for freehand drawing (WB-1); the loader rejects a template that omits it. The whiteboard layout is withheld from the AI's option set (never auto-selected); users add it via the layout picker. |

Slots use the WYSIWYG-ready object form — the same shape the future
editor will author and MongoDB will store:

```json
{ "name": "body", "kind": "text", "label": "Slide body",
  "multiline": true, "maxChars": 400,
  "style": {}, "metadata": {} }
```

`kind` selects the client editor (`text` | `bullets` | `image`);
`maxChars` is per-slot validation that **overrides the layout-level
constraint** for that slot; `style` and `metadata` are reserved for the
visual editor. Conventional slot names (`title`, `body`, `bullets`,
`image`, `caption`) may be written as bare-string shorthand and expand
from the shared defaults; custom-named slots must declare their `kind`.
The starter files use the full object form so a file and a future DB
document are shape-identical.

Layout-level `constraints` are the budget fallback, enforced both in the
generation prompt and server-side
([slide-fit.ts](../server/src/lib/slide-fit.ts)): `maxTitleChars`,
`maxBodyChars`, `maxBulletChars`, `maxCaptionChars` (characters, not
words, so budgets hold in unspaced languages like Mandarin), `maxBullets`, plus
`maxBodyLength` (legacy chars) and `imageRequired`.

### User templates: MongoDB

A user's own templates live in the `templates` collection
([model](../server/src/models/template.ts)) with the same shape as a file:
`name`, `theme`, `layouts`. They are validated by the **same zod schema the
file loader uses**, so a saved template cannot be shaped differently from a
shipped one — including the required `whiteboard` layout
([TMPL-7](SPEC.md#tmpl-7-whiteboard-layout)).

| Action | |
| --- | --- |
| `template.list` | The caller's library: their own templates first, then the built-ins. |
| `template.duplicate` | Copies any template they can see into their library. **This is how a template is created** — starting from one that already renders means no starter theme or layout set is written into code. |
| `template.update` | Name, theme, layout labels and purposes, which layouts the template has, and who may use it. |
| `template.delete` | Tombstones it (P-10). |

Built-ins are read-only: they come from files a deployment controls, and
editing one into the database would silently diverge from its file.

**Nothing in code names a template.** The fallback for a new project or an
unresolvable id is `DEFAULT_TEMPLATE_ID`, defaulting to the first template in
`TEMPLATES_DIR` — a deployment can replace the starter set entirely without a
code change.

**A deleted template never breaks a lecture.** Read paths
(`resolveTemplateForRead`) fall back to that default while the deck keeps its
`templateId`, so restoring the template brings its look back. Validation paths
still reject an id that names nothing.

### The code: `client/src/components/slide/layouts/`

The one template-related thing that is not data: **presentation
geometry**. Each layout type has a hand-tuned
React/Tailwind component (grid vs. stack, `cqi` sizes, alignment)
implementing the shared `LayoutProps { slide, colors, slot }` contract
and registered by name in `layouts/index.tsx`.
[SlideView](../client/src/components/SlideView.tsx) just looks the
renderer up by the slide's `layoutType`; components decide *where*
things go, while *what* each slot contains and *how it edits* flows in
through the `slot(name)` callback (the slot system). Unknown layout
types render through the `GenericLayout` fallback — degraded, never
blank.

### The flow, end to end

1. The template file's layout descriptors (purposes, slots, budgets) are
   serialized into the generation prompt — the AI picks a `type` and
   fills its slots.
2. The server enforces the budgets (slot `maxChars` over layout
   constraints) regardless of what the model returns.
3. The client resolves the layout renderer by `type` and each slot's
   editor by `kind`, with the template's own slot spec taking precedence
   over the conventional defaults.

A contract test
([contract.test.tsx](../client/src/components/slide/layouts/contract.test.tsx))
renders every registered layout against every template file and fails if
declared and rendered slot sets differ — drift in either direction means
invisible content or never-filled slots.

**Adding a layout type today** = one renderer component + one registry
entry + declaring the layout in a template file (the contract test binds
them).

## Arrangement is data ([TMPL-4](SPEC.md#tmpl-4-custom-templates-create--edit--save))

A layout can carry its own **arrangement**: a box per slot, in percentages of
the slide, stored in `elementPositions` and keyed by slot name.

```json
"elementPositions": { "title": { "x": 10, "y": 5, "w": 80, "h": 20 } }
```

[`PositionedLayout`](../client/src/components/slide/layouts/PositionedLayout.tsx)
turns that data into DOM — one renderer, any arrangement. Percentages rather
than pixels, so an arrangement holds at any size: the thumbnail in the library
and the full-bleed viewer are the same layout scaled.

**Both worlds coexist, on purpose.** `rendererFor(type, layout)` picks the
engine when a layout has positions and the hand-tuned component when it does
not. Every built-in still has none, so nothing about them changed. That is the
seam the demolition below runs through: a layout moves to data on its own,
and can move back by clearing its positions.

Boxes are validated by the same zod schema as everything else in a template —
inside the slide, and naming only slots the layout declares — so an
arrangement cannot hide content where nobody can reach it. The editor keeps
boxes in bounds while you drag, and offers the same numbers as inputs, because
a drag is not reachable from a keyboard.

### What is still to come

1. ~~**Storage moves to MongoDB.**~~ Done — see "User templates" above.
2. ~~**Arrangement becomes data.**~~ Done — the engine above. Two pieces of the
   original plan remain, and only matter once users invent slots of their own:
   `LayoutType` widening from the seven-value union to open strings, and slide
   content moving from fixed fields to a slot-name map. Positioning the
   conventional slots (`title`, `body`, `image`, `caption`) needs neither,
   which is why it landed first.
3. **The rest of the original plan.** Users can't ship React components, so
   the editor writes each layout's geometry into the reserved
   `elementPositions` field (regions, placement, per-slot styling), and
   a **data-driven rendering engine** — grown from today's
   `GenericLayout` fallback — turns it into DOM. `LayoutType` widens
   from the seven-value union to open strings, and slide content moves
   from fixed fields to a slot-name map so custom slots can persist.
4. **The hand-tuned layout components become removable.** They are
   scaffolding with a planned demolition: once the engine exists, we
   convert one built-in layout to `elementPositions` data, compare it
   side by side with its component, and when the data version is
   indistinguishable, convert the rest and delete the components. The
   registry makes this incremental — each layout type flips from
   "component" to "engine + data" independently. What can never be
   deleted is the engine itself: some code must always interpret
   arrangement data.

End state: `server/config/templates` (then MongoDB) holds *everything*
about a template; `client/.../layouts` shrinks to the engine plus,
optionally, any built-ins we choose to keep hand-tuned for quality.

The slide scaling strategy (container-query units) and z-index tiers are
in [DECISIONS.md](DECISIONS.md).
