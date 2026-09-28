/**
 * The design object behind a `templateId` a deck, project or account already
 * knows (TMPL-28) — fetched by id (`template.getById`) once, for
 * `TemplateDesignPanel`'s "Current design" pin and its descriptor notice.
 *
 * Owned by the caller rather than by the panel itself, because one caller
 * (`DeckSettingsModal`'s `TemplateUpdateNotice`) needs the very same object
 * for a second reason of its own — applying a pinned template update reports
 * back the deck alone, and the template it just re-applied is this one, by
 * the same id. Fetching it once here and handing it down avoids a second,
 * identical fetch inside the panel.
 *
 * Refetches only when `templateId` changes to something this hook does not
 * already hold — a caller that just applied a new design already has the
 * full object (from `onSelect`) and sets it directly, so the id changing
 * underneath that set finds nothing to do.
 *
 * An empty `templateId` (a caller with no Design tab at all — an admin on
 * someone else's account settings, say) fetches nothing and pins nothing,
 * rather than asking the server for a template with no id.
 */
import { useEffect, useState } from 'react'
import type { Template } from '@slide-machine/shared'
import { dispatchAction } from '../../api/actions'

export function useCurrentTemplate(
  templateId: string,
): [
  Template | null | undefined,
  React.Dispatch<React.SetStateAction<Template | null | undefined>>,
] {
  const [current, setCurrent] = useState<Template | null | undefined>(undefined)

  useEffect(() => {
    if (!templateId || current?.id === templateId) return
    let cancelled = false
    dispatchAction<Template>('template.getById', { templateId })
      .then(t => {
        if (!cancelled) setCurrent(t)
      })
      // Quiet failure: nothing is pinned and the descriptor notice simply
      // does not show, same as any other card metadata that failed to load.
      .catch(() => {
        if (!cancelled) setCurrent(null)
      })
    return () => {
      cancelled = true
    }
  }, [templateId, current])

  return [current, setCurrent]
}
