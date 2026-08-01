/**
 * One displayable name for a template (TECH-12).
 *
 * The starter set that ships with the app — `server/config/templates/`,
 * ids `classic`/`midnight`/`seminar` — is product chrome, so its names
 * come from the bundle, keyed by template id. Anything else is data: a
 * user's own template ([TMPL-4](../../../docs/SPEC.md)) or one imported
 * from YAML carries a name its author chose, and an unknown id falls
 * back to that name as written.
 *
 * This mirrors how slot labels are handled in `components/slide/slots.tsx`
 * — the bundle wins for what the app authored, the author wins for the
 * rest (docs/I18N.md).
 */
import type { TFunction } from 'i18next'
import type { Template } from '@slide-machine/shared'

export const templateName = (
  t: TFunction,
  template: Pick<Template, 'id' | 'name'>,
): string => t(`template.names.${template.id}`, { defaultValue: template.name })
