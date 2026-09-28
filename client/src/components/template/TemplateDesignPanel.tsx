/**
 * The Design tab's template section (TMPL-1/TMPL-4/TMPL-28): the same
 * Latest/Top/Mine browser and search the Design Templates page offers
 * (`TemplateBrowser`'s select mode), plus the pieces only a settings tab
 * needs — the descriptor-budget notice for whatever is applied, and the
 * Import control.
 *
 * Shared by the lecture, project and account settings modals so a design is
 * chosen and managed the same way wherever it is chosen — the three differ
 * only in what selecting one applies to and what their own intro text says,
 * which is the caller's business, not this panel's.
 */
import { useState } from 'react'
import { useLocation } from 'react-router'
import type {
  Template,
  TemplateFeedSort,
  VoteResult,
} from '@slide-machine/shared'
import TemplateBrowser from './TemplateBrowser'
import TemplateImportControl from './TemplateImportControl'
import TemplateDescriptorNotice from './TemplateDescriptorNotice'

export default function TemplateDesignPanel({
  value,
  current,
  onSelect,
  onCurrentVote,
  onCurrentDeleted,
}: {
  value: string
  /** The design currently applied, however the caller already has it
   * (`useCurrentTemplate`, by `value`) — `null` once a fetch has settled
   * with nothing, `undefined` while still in flight. */
  current: Template | null | undefined
  /** Chooses a template — a card in the browser, a fresh duplicate, or an
   * import — and applies it. */
  onSelect: (template: Template) => void
  /** A vote cast on the pinned "Current design" card (TMPL-27 round 3),
   * passed straight through so the caller can patch its own `current` —
   * see `TemplateBrowser`'s own doc comment for why. */
  onCurrentVote?: (templateId: string, result: VoteResult) => void
  /** The pinned "Current design" was itself just deleted (its owner, from
   * its own action row) — passed straight through so the caller clears its
   * own `current` rather than going on pinning a design that no longer
   * exists. */
  onCurrentDeleted?: () => void
}) {
  const location = useLocation()
  // Mine, if the caller already belongs to this design's people list one way
  // or another (owns it, or was shared it as an editor or viewer) — that is
  // the library a caller choosing a design is most likely mid-errand in.
  // Otherwise Latest, same as the Design Templates page. Frozen at mount
  // (this panel remounts fresh every time its settings tab is opened, see
  // `DeckSettingsModal`'s own `{tab === 'template' && ...}`), not recomputed
  // on every render — a design applied *while* the tab is open should not
  // retroactively jump the sort out from under whatever the caller is
  // already browsing.
  const [initialSort] = useState<TemplateFeedSort>(() =>
    current?.myRole ? 'mine' : 'latest',
  )

  return (
    <>
      {current && <TemplateDescriptorNotice template={current} />}
      <TemplateBrowser
        mode="select"
        dense
        initialSort={initialSort}
        value={value}
        current={current}
        onSelect={onSelect}
        onCurrentVote={onCurrentVote}
        onCurrentDeleted={onCurrentDeleted}
        linkState={{ from: location.pathname }}
      />
      {/* One way in, three sources, opened in a dialog rather than inline
          (TMPL-28): a design arriving from Slides, from a file this app
          wrote earlier, or from Drive is the same event to the browser, so
          the tab offers one button rather than three controls. Applied
          straight away, the way a fresh duplicate is: an import exists to be
          used, and seeing it in place is how it gets reviewed. */}
      <TemplateImportControl onImported={onSelect} />
    </>
  )
}
