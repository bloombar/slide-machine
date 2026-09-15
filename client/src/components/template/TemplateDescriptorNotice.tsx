/**
 * "Your instructions are getting long" — the advisory for a template whose
 * assembled generation menu exceeds the recommended budget (TMPL-25).
 *
 * The menu — every layout, box and authoring instruction (TMPL-10) — always
 * reaches the model in full; nothing here is ever trimmed on the author's
 * behalf. But a long menu is latency a lecture's audience feels, so once it
 * grows past `GENERATION_DESCRIPTOR_MAX_CHARS` the author is told, the same
 * way TemplateUpdateNotice tells them their design has moved on: same
 * placement, same visual weight, so a design-level advisory is one kind of
 * thing to meet, not two. It is advice, not an error — the template
 * generates slides at any length — and there is nothing to dismiss: it
 * clears itself the moment the instructions are edited back under budget.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Template, TemplateDescriptorStatus } from '@slide-machine/shared'
import { dispatchAction } from '../../api/actions'

export default function TemplateDescriptorNotice({
  template,
}: {
  /** The saved template — measured server-side (`layoutDescriptors` +
   * `descriptorStatus`, the same pair the live prompt is built from), so an
   * unsaved edit in the editor is reflected once it is saved, the way
   * generation itself would only ever see the saved version. Taken as the
   * whole object, not just its id, so a save that shortens the instructions
   * — a new object with the same id — re-measures instead of reading stale. */
  template: Template
}) {
  const { t } = useTranslation()
  // Tagged with the id it was fetched for, so a response that lands after
  // the template has already switched can be told apart from one that
  // belongs to what is on screen now — see `result` below.
  const [fetched, setFetched] = useState<{
    templateId: string
    status: TemplateDescriptorStatus | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    dispatchAction<TemplateDescriptorStatus>('template.descriptorStatus', {
      templateId: template.id,
    })
      .then(res => {
        if (!cancelled) setFetched({ templateId: template.id, status: res })
      })
      // A status that cannot be read is not worth an error in the user's
      // face: the template still generates slides, it simply is not being
      // measured right now.
      .catch(() => {
        if (!cancelled) setFetched({ templateId: template.id, status: null })
      })
    return () => {
      cancelled = true
    }
  }, [template])

  // Discarded, not just left stale, once the template it was measured for is
  // no longer what's on screen: without this, switching from an over-budget
  // design to an under-budget one keeps showing the old design's length and
  // warning until the new response lands.
  const status = fetched?.templateId === template.id ? fetched.status : null

  if (!status?.overBudget) return null

  return (
    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-medium text-amber-900">
        {t('template.descriptorBudget.heading')}
      </p>
      <p className="mt-0.5 text-xs text-amber-800">
        {t('template.descriptorBudget.hint', {
          length: status.length,
          max: status.max,
        })}
      </p>
    </div>
  )
}
