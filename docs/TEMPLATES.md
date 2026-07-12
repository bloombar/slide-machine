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
| `layouts` | The layout set. Each layout: `type` (one of the seven conventional types, SPEC TMPL-2), `label`, `purpose` (**read by the AI** when choosing layouts), `slots`, `constraints`, `elementPositions` (reserved). |

`constraints` are the word budgets enforced both in the generation prompt
and server-side ([slide-fit.ts](../server/src/lib/slide-fit.ts)):
`maxTitleWords`, `maxBodyWords`, `maxBulletWords`, `maxCaptionWords`,
`maxBullets`, plus `maxBodyLength` (legacy chars) and `imageRequired`.

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
