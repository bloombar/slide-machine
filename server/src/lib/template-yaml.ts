/**
 * Serializes a style template into a standards-based, human-readable YAML
 * document (SPEC EXP-2): both slide decks AND style templates can be exported.
 * The format captures the template's identity, its theme (colors/typography),
 * and its layout descriptors (structure), so the look can be shared or
 * re-imported (EXP-3) independently of a deck.
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
    // The full visual theme (colors, typography) — the styling itself.
    theme: template.theme,
    // The layout descriptors (structure): what each layout is for and its slots.
    layouts: template.layouts.map(layout => ({
      type: layout.type,
      label: layout.label,
      purpose: layout.purpose,
      slots: layout.slots,
      ...(layout.constraints ? { constraints: layout.constraints } : {}),
    })),
  }
  return YAML.stringify(doc)
}
