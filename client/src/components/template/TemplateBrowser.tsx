/**
 * The browsable design library (TMPL-1/TMPL-28): Latest/Top/Mine, search, and
 * infinite scroll over every template the caller can read — extracted from
 * the Design Templates page (`/app/templates`) so the Design tab in lecture,
 * project and account settings can offer the identical browsing experience
 * rather than a forked, thinner one of its own.
 *
 * Two modes cover the two places this is used:
 *   - **link** (the page): a card opens the design's own page (`/t/:slug`).
 *   - **select** (the Design tab): a card is a radio in a radiogroup, and
 *     choosing it calls `onSelect(template)` so the caller can apply it.
 *
 * Select mode also pins the design currently applied above the grid as
 * "Current design" (TMPL-28) — it may not be on the visible tab or page (a
 * shared design nobody has voted for lately, say), so this is the only way
 * the caller always sees what a lecture, project or account is actually
 * drawn with. The caller supplies it, having already fetched it however it
 * has the id (`template.getById`); if it also shows up on the fetched page
 * below, it is left out there rather than doubled — one design should not
 * offer two radios for the same value.
 */
import { forwardRef, useImperativeHandle, useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import type {
  Template,
  TemplateFeedSort,
  TemplatePage,
  VoteResult,
} from '@slide-machine/shared'
import { dispatchAction } from '../../api/actions'
import { templateName } from '../../i18n/templateName'
import ConfirmDialog from '../ConfirmDialog'
import DiscoverControls, { type SortTab } from '../discover/DiscoverControls'
import LoadMore from '../discover/LoadMore'
import { useDiscover, type DiscoverSource } from '../discover/useDiscover'
import TemplateCard from './TemplateCard'

/** `template.feed` and `template.search` both answer `TemplatePage`
 * (`{items, hasMore}`) — the feed side of `useDiscover` already reads
 * `.items` generically, so only the search side needs telling how to pull
 * rows out of its own response, in place of a lecture search's grouped
 * `lectures`/`projects`/`users` shape. */
const TEMPLATE_SOURCE: DiscoverSource<Template> = {
  feedAction: 'template.feed',
  searchAction: 'template.search',
  normalizeSearch: res => (res as TemplatePage).items,
}

/** Latest/Top, the same two Discover offers, plus "Mine" — a design's own
 * third sort (TMPL-28), which no lecture list has. Fixed rather than a prop:
 * the page and the Design tab offer exactly the same three, wherever this is
 * mounted. */
const SORTS: SortTab<TemplateFeedSort>[] = [
  { value: 'latest', labelKey: 'discover.latest' },
  { value: 'top', labelKey: 'discover.top' },
  { value: 'mine', labelKey: 'templatesPage.mine' },
]

export interface TemplateBrowserHandle {
  /** After an import lands (TMPL-28): switches to "Mine", where the new
   * design now lives, or refreshes it if that is already the open tab.
   * Meaningful in link mode only — the Design tab applies an import in
   * place instead, so there is nothing here for it to jump to. */
  showMine: () => void
}

const TemplateBrowser = forwardRef<
  TemplateBrowserHandle,
  {
    mode: 'link' | 'select'
    /** Which sort opens first. Both modes default to "Latest" (round 1
     * simplicity — see DECISIONS "Design tab browses like the page"); the
     * Design Templates page overrides it to land on "Mine" when a design the
     * caller owns just sent them back here. */
    initialSort?: TemplateFeedSort
    /** `history.state` carried onto every card opened as a link, or onto a
     * duplicate's own page — the same `state.from` chain a design's own page
     * reads its Back button from. */
    linkState: unknown
    /** Tighter grid for the settings sheets, which are narrower than the
     * full page (TMPL-28). */
    dense?: boolean
    /** Select mode only: the template id currently applied, and the design
     * itself once the caller has fetched it (`template.getById`) — pinned
     * above the grid as "Current design" so it is always visible even when
     * the tab or page open right now would not otherwise show it. `null`
     * once a fetch has settled with nothing (a deleted template); `undefined`
     * while it is still in flight, when nothing is pinned yet either. */
    value?: string
    current?: Template | null
    onSelect?: (template: Template) => void
    /** A vote cast on the pinned "Current design" card (TMPL-27): the caller
     * owns that object, not this component, so a settled vote is handed back
     * for it to patch into its own state — the grid's own cards need no such
     * thing, since `useDiscover.patch` already keeps those in step. */
    onCurrentVote?: (templateId: string, result: VoteResult) => void
  }
>(function TemplateBrowser(
  {
    mode,
    initialSort = 'latest',
    linkState,
    dense = false,
    value,
    current,
    onSelect,
    onCurrentVote,
  },
  ref,
) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const discover = useDiscover<Template, TemplateFeedSort>({
    source: TEMPLATE_SOURCE,
    initialSort,
  })
  const [busyId, setBusyId] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Template | null>(null)
  // Set only while the confirmed delete's own request is in flight, so the
  // dialog's confirm button can be held down against a second click — never
  // conflated with `busyId`, which also covers a Duplicate in flight and
  // must not disable a dialog that is not even open.
  const [deleting, setDeleting] = useState(false)

  useImperativeHandle(ref, () => ({
    // Clears any search too, which would otherwise go on hiding a design
    // that does not match it. Switching sort or clearing the query already
    // refetches page one; `refresh()` covers the one case neither changes.
    showMine: () => {
      const unchanged = discover.sort === 'mine' && discover.query.trim() === ''
      discover.setSort('mine')
      discover.setQuery('')
      if (unchanged) discover.refresh()
    },
  }))

  /** Opens a design's own page, carrying whatever the caller wants its own
   * Back button to return to. */
  const open = (template: Template) => {
    void navigate(`/t/${template.permalinkSlug}`, { state: linkState })
  }

  const duplicate = (template: Template) => {
    setBusyId(template.id)
    setError(null)
    dispatchAction<Template>('template.duplicate', {
      templateId: template.id,
    })
      .then(copy => {
        // In select mode the copy is what the author is now working on, so
        // it is what they are working on it for: applied straight away, the
        // same as duplicating from the Design tab always has.
        if (mode === 'select') onSelect?.(copy)
        open(copy)
      })
      .catch(() => setError(t('template.errors.duplicate')))
      .finally(() => setBusyId(undefined))
  }

  /** In link mode, editing is just opening — the page has no picker to
   * apply anything to. In select mode, opening a template's settings
   * chooses it too: editing a design is done to see it in place. */
  const edit = (template: Template) => {
    if (mode === 'select' && template.id !== value) onSelect?.(template)
    open(template)
  }

  const remove = (template: Template) => {
    setDeleting(true)
    setError(null)
    dispatchAction('template.delete', { templateId: template.id })
      .then(() => {
        // Shrinks the same array `loadMore`'s own offset is computed from —
        // see `useDiscover.remove`'s own comment for why this must go
        // through the hook rather than a filter kept alongside it.
        discover.remove(template.id)
        setConfirming(null)
      })
      .catch(() => {
        // Closed either way (round 2): a dialog left open over an error the
        // reader cannot see through it is worse than losing the confirm
        // step — the error below the controls is what is actually visible.
        setConfirming(null)
        setError(t('template.errors.delete'))
      })
      .finally(() => setDeleting(false))
  }

  const { page, searching, query, error: loadError, loadingMore } = discover
  // The pinned "Current design" above (select mode) already shows this one;
  // a second radio for the same value here would be two controls for one
  // choice, which is not a valid radiogroup.
  const items = (page?.lectures ?? []).filter(item => item.id !== current?.id)

  const message = (text: string) => (
    <p className="px-1 py-6 text-sm text-slate-500">{text}</p>
  )

  const card = (template: Template) => (
    <TemplateCard
      key={template.id}
      template={template}
      selected={mode === 'select' ? value === template.id : undefined}
      onSelect={mode === 'select' ? () => onSelect?.(template) : undefined}
      linkTo={
        mode === 'link'
          ? { to: `/t/${template.permalinkSlug}`, state: linkState }
          : undefined
      }
      onDuplicate={duplicate}
      // `TemplateCard` already gates these on `myRole` itself (round 2) —
      // passing them unconditionally here just gives it the handler;
      // whether they render is its call, not a second copy of the same rule
      // kept alongside it.
      onEdit={edit}
      onDelete={template => setConfirming(template)}
      busyId={busyId}
      showMeta
      onVote={(templateId, res) =>
        discover.patch(templateId, item => ({
          ...item,
          votes: { up: res.up, down: res.down, myVote: res.myVote },
        }))
      }
    />
  )

  const gridClassName = dense
    ? 'grid grid-cols-2 gap-4 sm:grid-cols-3'
    : 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'

  const results = () => {
    if (loadError)
      return message(
        searching
          ? t('templatesPage.searchFailed')
          : t('templatesPage.loadFailed'),
      )
    if (!page)
      return message(searching ? t('discover.searching') : t('common.loading'))
    // Nothing to draw a grid of, but there IS more to fetch (every row on
    // this page was just deleted, round 2): the load trigger still has to
    // show, or a caller who cleared their own last page in view would be
    // stuck looking at an "empty" message the moment before scrolling on
    // would have moved past it.
    if (items.length === 0 && !page.hasMore) {
      if (searching)
        return message(t('templatesPage.noMatches', { query: query.trim() }))
      return message(
        discover.sort === 'mine'
          ? t('templatesPage.emptyMine')
          : t('templatesPage.empty'),
      )
    }
    return (
      <>
        {items.length > 0 && (
          <div className={gridClassName}>{items.map(card)}</div>
        )}
        {page.hasMore && (
          <LoadMore onLoadMore={discover.loadMore} loading={loadingMore} />
        )}
      </>
    )
  }

  return (
    // A single radiogroup wraps the pinned "Current design" and the fetched
    // grid together (select mode only) — one logical choice, even though the
    // card that is already applied is drawn above the controls that page
    // through the rest of it. Link mode has no radios at all, so no group.
    <div
      role={mode === 'select' ? 'radiogroup' : undefined}
      aria-label={mode === 'select' ? t('template.label') : undefined}
    >
      {mode === 'select' && current && (
        <div className="mb-4">
          <p className="mb-2 px-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
            {t('templatesPage.current')}
          </p>
          <div className={gridClassName}>
            <TemplateCard
              template={current}
              selected
              onSelect={() => onSelect?.(current)}
              onDuplicate={duplicate}
              onEdit={edit}
              onDelete={template => setConfirming(template)}
              busyId={busyId}
              showMeta
              onVote={(templateId, res) => onCurrentVote?.(templateId, res)}
            />
          </div>
        </div>
      )}
      <DiscoverControls
        sort={discover.sort}
        onSortChange={discover.setSort}
        query={discover.query}
        onQueryChange={discover.setQuery}
        sorts={SORTS}
        searchLabelKey="templatesPage.searchLabel"
        searchPlaceholderKey="templatesPage.searchPlaceholder"
        className="mb-4 px-0"
      />
      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      )}
      {results()}
      {confirming && (
        <ConfirmDialog
          title={t('template.delete.title')}
          message={t('template.delete.message', {
            name: templateName(t, confirming),
          })}
          confirmLabel={t('common.delete')}
          busy={deleting}
          onConfirm={() => remove(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  )
})

export default TemplateBrowser
