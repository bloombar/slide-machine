/**
 * Serializes a style template into a standards-based, human-readable YAML
 * document (SPEC EXP-2): both slide decks AND style templates can be exported.
 * The format captures the template's identity, its theme (colors/typography),
 * and its layouts, so the look can be shared or re-imported (EXP-3)
 * independently of a deck.
 *
 * "Its layouts" means the whole layout, not the descriptor. EXP-2 asks for a
 * template's **geometry** — where each box sits and how it is styled — so the
 * file describes the design fully enough to reconstruct it. A descriptor-only
 * export says a layout has a picture box somewhere and nothing about where,
 * which is a list of ingredients rather than a design, and cannot round-trip
 * (EXP-3).
 *
 * So each layout carries:
 *   - `slots` — name, kind, authoring instructions and limits (TMPL-9/TMPL-10)
 *   - `tree` — the containers and boxes the design is built from, which is
 *     what the author edits and what the renderer draws (TMPL-4)
 *   - `elementPositions` — the same arrangement as absolute boxes, for the
 *     readers that cannot run CSS, and the whole of an imported design (TMPL-8)
 *   - `decoration` — the bands, rules and logos painted behind the slots
 *   - `guides` — the guidelines its author worked to
 *
 * `decoration` belongs in that list for the same reason geometry does. A deck
 * imported from Google Slides keeps its logo and its colour bands as
 * decoration, so leaving it out would export such a template without the
 * pieces that make it recognizable — a round trip that quietly drops the
 * design is not one (EXP-3).
 *
 * Produced with the `yaml` library (never hand-built) so output is always valid.
 */
import YAML from 'yaml'
import type { Template } from '@slide-machine/shared'

/** Format marker for a template export (its own version line, like decks). */
export const TEMPLATE_YAML_VERSION = 1

/** Renders a template to a YAML string: identity, theme, and layouts. */
export const templateToYaml = (template: Template): string => {
  const doc = {
    version: TEMPLATE_YAML_VERSION,
    kind: 'template',
    id: template.id,
    name: template.name,
    visibility: template.visibility,
    ...(template.renderMode ? { renderMode: template.renderMode } : {}),
    // The full visual theme (colors, typography) — the styling itself.
    theme: template.theme,
    // Each layout in full: what it is for, what it holds, and how it is built.
    layouts: template.layouts.map(layout => ({
      type: layout.type,
      label: layout.label,
      purpose: layout.purpose,
      slots: layout.slots,
      ...(layout.constraints ? { constraints: layout.constraints } : {}),
      ...(layout.tree ? { tree: layout.tree } : {}),
      // Omitted when empty rather than written as `{}`: a layout that was
      // never measured has no geometry to state, and saying so in the file
      // would read as "it has none" instead of "it is in the tree".
      ...(Object.keys(layout.elementPositions ?? {}).length
        ? { elementPositions: layout.elementPositions }
        : {}),
      // Same rule as geometry: written when there is some, absent when the
      // design has none, rather than an empty list that reads as "no logo".
      ...(layout.decoration?.length ? { decoration: layout.decoration } : {}),
      ...(layout.guides ? { guides: layout.guides } : {}),
    })),
  }
  return YAML.stringify(doc)
}
