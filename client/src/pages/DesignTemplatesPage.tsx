/**
 * Every design template on a page of its own (TMPL-28), at `/app/templates`:
 * built-ins and public designs by Latest or Top, or the caller's own library
 * ("Mine" — owned or shared with them) by "Mine", with a search box and
 * infinite scroll — the same browsing machinery Discover already gives
 * lectures (SOC-2/SOC-3), reused rather than forked.
 *
 * Cards are drawn the way the Design tab's `TemplateLibrary` draws them
 * (`TemplateCard`, shared), with more room here for a byline, a layout
 * count and a description below the thumbnail. Unlike the Design tab, a
 * card here is never "selected" for anything — clicking it opens the
 * design's own page (`/t/:slug`) as a plain link (`TemplateCard`'s `linkTo`),
 * the same landing `TemplateDesignPanel`'s duplicate and edit already use,
 * so its own Back button returns here — landing on "Mine" rather than this
 * page's own default whenever the design it left is the caller's own
 * (`location.state.sort`, set by `TemplateEditorPage`'s Back).
 */
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import type {
  Template,
  TemplateFeedSort,
  TemplatePage,
} from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { templateName } from '../i18n/templateName'
import ConfirmDialog from '../components/ConfirmDialog'
import DiscoverControls, {
  type SortTab,
} from '../components/discover/DiscoverControls'
import LoadMore from '../components/discover/LoadMore'
import {
  useDiscover,
  type DiscoverSource,
} from '../components/discover/useDiscover'
import TemplateCard from '../components/template/TemplateCard'
import TemplateImportControl from '../components/template/TemplateImportControl'

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
 * third sort (TMPL-28), which no lecture list has. */
const SORTS: SortTab<TemplateFeedSort>[] = [
  { value: 'latest', labelKey: 'discover.latest' },
  { value: 'top', labelKey: 'discover.top' },
  { value: 'mine', labelKey: 'templatesPage.mine' },
]

export default function DesignTemplatesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  // Coming back from a design the caller owns (TMPL-28) lands on "Mine",
  // where that design actually lives — `TemplateEditorPage`'s Back sets this
  // rather than the URL, since nothing else here needs the sort in the
  // address bar. Any other value, or none, keeps the page's own default.
  const initialSort =
    (location.state as { sort?: TemplateFeedSort } | null)?.sort === 'mine'
      ? 'mine'
      : 'latest'
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

  /** Opens a design's own page, remembering this page so its Back returns
   * here — the same `state.from` chain `TemplateDesignPanel` starts. */
  const open = (template: Template) => {
    void navigate(`/t/${template.permalinkSlug}`, {
      state: { from: '/app/templates' },
    })
  }

  const duplicate = (template: Template) => {
    setBusyId(template.id)
    setError(null)
    dispatchAction<Template>('template.duplicate', {
      templateId: template.id,
    })
      .then(copy => open(copy))
      .catch(() => setError(t('template.errors.duplicate')))
      .finally(() => setBusyId(undefined))
  }

  /** Editing, like opening, happens on the design's own page — there is no
   * inline editor here. */
  const edit = (template: Template) => open(template)

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
  const items = page?.lectures ?? []

  const message = (text: string) => (
    <p className="px-1 py-6 text-sm text-slate-500">{text}</p>
  )

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                linkTo={{
                  to: `/t/${template.permalinkSlug}`,
                  state: { from: '/app/templates' },
                }}
                onDuplicate={duplicate}
                // `TemplateCard` already gates these on `myRole` itself
                // (round 2) — passing them unconditionally here just gives
                // it the handler; whether they render is its call, not a
                // second copy of the same rule kept alongside it.
                onEdit={edit}
                onDelete={template => setConfirming(template)}
                busyId={busyId}
                showMeta
                // Keeps this row's own `votes` in step with whatever the
                // control just cast (round 3) — see `useDiscover.patch`'s
                // own comment for why: a sort switch away and back can show
                // this exact page again, cached, before its own refetch has
                // returned, and that instant would flash pre-vote counts
                // without this.
                onVote={(templateId, res) =>
                  discover.patch(templateId, item => ({
                    ...item,
                    votes: { up: res.up, down: res.down, myVote: res.myVote },
                  }))
                }
              />
            ))}
          </div>
        )}
        {page.hasMore && (
          <LoadMore onLoadMore={discover.loadMore} loading={loadingMore} />
        )}
      </>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-8">
      {/* Import behaves exactly as it does on the Design tab (TMPL-28): the
          same shared control, opening in a dialog rather than a settings
          form this page does not have, staying open with its own report
          rather than navigating away underneath it. There is nothing here
          to apply the import to the way the Design tab's picker does, so
          the page switches to Mine instead — where the new design actually
          lives — and refreshes it, since a sort already on Mine has nothing
          of its own to react to a design merely being added to it. An
          "Open design" action in the dialog itself is the way from here to
          the new design's own page, the same one the Design tab's copy gets
          from `TemplateImportControl`. */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('templatesPage.heading')}</h1>
        <TemplateImportControl
          onImported={() => {
            if (discover.sort === 'mine') discover.refresh()
            else discover.setSort('mine')
          }}
        />
      </div>
      {/* What a design template is for (TMPL-28): plain enough that a first-time
          visitor knows why a page of these exists before browsing them. */}
      <p className="mt-2 mb-4 text-sm text-slate-600">
        {t('templatesPage.explanation')}
      </p>
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
}
