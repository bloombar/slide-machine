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
import { useCallback, useEffect, useState } from 'react'
import type { Template, VoteResult } from '@slide-machine/shared'
import { dispatchAction } from '../../api/actions'

export interface UseCurrentTemplate {
  /** `null` once a fetch has settled with nothing (a deleted template);
   * `undefined` while still in flight. */
  current: Template | null | undefined
  setCurrent: React.Dispatch<React.SetStateAction<Template | null | undefined>>
  /** A vote cast on the pinned card (TMPL-27): patches `current`'s own tally
   * in place, the one bit of `TemplateBrowser`'s `onCurrentVote` every
   * caller needed identically, so it lives here instead of copied at each
   * of the three call sites. */
  patchVote: (templateId: string, result: VoteResult) => void
}

export function useCurrentTemplate(templateId: string): UseCurrentTemplate {
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

  const patchVote = useCallback(
    (voteId: string, result: VoteResult) =>
      setCurrent(t =>
        t && t.id === voteId
          ? {
              ...t,
              votes: {
                up: result.up,
                down: result.down,
                myVote: result.myVote,
              },
            }
          : t,
      ),
    [],
  )

  // No id means nothing applied, not "still loading" — a caller waiting on
  // `undefined` would otherwise wait forever.
  return { current: templateId ? current : null, setCurrent, patchVote }
}
