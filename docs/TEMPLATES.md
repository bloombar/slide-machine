# Slide templates

The starter templates live as **JSON files in
[`server/config/templates/`](../server/config/templates/)** — one file per
template (`classic.json`, `midnight.json`, `seminar.json`), editable and
extendable without a code change. Drop a new `*.json` in the directory to
add a template. This is the interim store: user-authored templates
(SPEC TMPL-4) will move to MongoDB later.

Each file contains:

| Field | Meaning |
| --- | --- |
| `id`, `name` | Stable id (referenced by decks/projects) and display name. |
| `theme` | Renderer colors: `background`, `surface`, `text`, `muted`, `accent`. |
| `layouts` | The layout set. Each layout: `type` (one of the seven conventional types, SPEC TMPL-2), `label`, `purpose` (**read by the AI** when choosing layouts), `slots`, `constraints`, `elementPositions` (reserved for data-driven arrangement). |

**Slots use the WYSIWYG-ready object form** — the same shape the future
template editor will author and MongoDB will store:

```json
{ "name": "body", "kind": "text", "label": "Slide body",
  "multiline": true, "maxWords": 60,
  "style": {}, "metadata": {} }
```

`kind` selects the client editor (`text` | `bullets` | `image`);
`maxWords` is per-slot validation that **overrides the layout-level
constraint** for that slot; `style` and `metadata` are reserved for the
visual editor. Conventional slot names (`title`, `body`, `bullets`,
`image`, `caption`) may be written as bare-string shorthand and are
expanded from the shared defaults; custom-named slots must declare their
`kind`. The starter files use the full object form so file and future DB
documents are shape-identical.

Layout-level `constraints` remain the budget fallback, enforced both in
the generation prompt and server-side
([slide-fit.ts](../server/src/lib/slide-fit.ts)): `maxTitleWords`,
`maxBodyWords`, `maxBulletWords`, `maxCaptionWords`, `maxBullets`, plus
`maxBodyLength` (legacy chars) and `imageRequired`.

**One place:** every piece of externalized template data — themes,
layouts, slots, validation — lives in this directory and nowhere else.
The only template-related thing outside it is code: the client's layout
renderers (below), which the data-driven engine will subsume for
user-authored layouts.

Files are zod-validated at first use ([builtin.ts](../server/src/templates/builtin.ts))
and fail loudly if malformed. `TEMPLATES_DIR` overrides the directory.
The Docker image ships `server/config/`.

Visual arrangement per layout lives in the client's **layout-renderer
registry** ([slide/layouts/](../client/src/components/slide/layouts/)):
one React/Tailwind component per layout type implementing the shared
`LayoutProps` contract, registered in `layouts/index.tsx`. Adding a
layout type = one component + one registry entry (+ declaring it in a
template file); unknown types render through a generic fallback. The
slide scaling strategy and z-index tiers are in
[DECISIONS.md](DECISIONS.md).

## Keeping files and renderers aligned

A contract test
([contract.test.tsx](../client/src/components/slide/layouts/contract.test.tsx))
renders every registered layout against every template file and fails if
the `slots` a file declares differ from the slots the component actually
renders — drift in either direction means invisible content or
never-filled slots.

## Toward user-authored layout types (TMPL-4)

Users defining their own layout types — with their own schemas — cannot
ship React components, so custom layouts will be **data**: the reserved
`elementPositions` field becomes the arrangement description, rendered by
a data-driven engine grown out of today's `GenericLayout` fallback. The
seams already in place for that step: layout types resolve through the
renderer registry (unknown types already fall back instead of breaking),
slot MEDIA KINDS are declared per slot (the slot system dispatches by
kind, not name), and word budgets/constraints travel with the template
file. The remaining schema work when it lands: widen `LayoutType` from
the seven-value union to open strings, let template files declare slot
names with kinds (beyond the six conventional names), and store slide
content as a slot-name map instead of fixed fields.
