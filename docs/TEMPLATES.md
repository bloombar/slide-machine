# Slide templates

A template is **data** (theme, layouts, slots, validation — all of it in
one place) plus, for now, a small amount of **code** (the visual
arrangement of each layout). This page documents how that works today
and how it changes once the WYSIWYG template editor (SPEC TMPL-4)
exists.

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
| `layouts` | The layout set. Each layout: `type` (one of the seven conventional types, SPEC TMPL-2), `label`, `purpose` (**read by the AI** when choosing layouts), `slots`, `constraints`, `elementPositions` (reserved — see the future section). |

Slots use the WYSIWYG-ready object form — the same shape the future
editor will author and MongoDB will store:

```json
{ "name": "body", "kind": "text", "label": "Slide body",
  "multiline": true, "maxWords": 60,
  "style": {}, "metadata": {} }
```

`kind` selects the client editor (`text` | `bullets` | `image`);
`maxWords` is per-slot validation that **overrides the layout-level
constraint** for that slot; `style` and `metadata` are reserved for the
visual editor. Conventional slot names (`title`, `body`, `bullets`,
`image`, `caption`) may be written as bare-string shorthand and expand
from the shared defaults; custom-named slots must declare their `kind`.
The starter files use the full object form so a file and a future DB
document are shape-identical.

Layout-level `constraints` are the budget fallback, enforced both in the
generation prompt and server-side
([slide-fit.ts](../server/src/lib/slide-fit.ts)): `maxTitleWords`,
`maxBodyWords`, `maxBulletWords`, `maxCaptionWords`, `maxBullets`, plus
`maxBodyLength` (legacy chars) and `imageRequired`.

### The code: `client/src/components/slide/layouts/`

The one template-related thing that is not data: **presentation
geometry**. Each of the seven layout types has a hand-tuned
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
2. The server enforces the budgets (slot `maxWords` over layout
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

## How it will work with the WYSIWYG editor (TMPL-4)

Users will create templates visually: add text/image/media slots, style
them, attach labels, metadata, and validation (word limits etc.), and
arrange them on the canvas. That changes three things and — deliberately
— nothing else:

1. **Storage moves to MongoDB.** The document schema is exactly today's
   file schema (that's why the starter files use the canonical object
   form). The loader becomes a query; every consumer downstream is
   untouched.
2. **Arrangement becomes data.** Users can't ship React components, so
   the editor writes each layout's geometry into the reserved
   `elementPositions` field (regions, placement, per-slot styling), and
   a **data-driven rendering engine** — grown from today's
   `GenericLayout` fallback — turns it into DOM. `LayoutType` widens
   from the seven-value union to open strings, and slide content moves
   from fixed fields to a slot-name map so custom slots can persist.
3. **The hand-tuned layout components become removable.** They are
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
