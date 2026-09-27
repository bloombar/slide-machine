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
 * design's own page (`/t/:slug`), the same landing `TemplateDesignPanel`'s
 * duplicate and edit already use, so its own Back button returns here.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { Template, TemplatePage } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'
import { ApiError } from '../api/http'
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
const SORTS: SortTab[] = [
  { value: 'latest', labelKey: 'discover.latest' },
  { value: 'top', labelKey: 'discover.top' },
  { value: 'mine', labelKey: 'templatesPage.mine' },
]

export default function DesignTemplatesPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const discover = useDiscover<Template>({ source: TEMPLATE_SOURCE })
  const [busyId, setBusyId] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Template | null>(null)
  // Ids a delete already removed (below). `useDiscover` only knows how to
  // refetch a whole page, not to take one row out of it, so a delete here
  // is reflected by filtering rather than by telling the hook about it.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())

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
    setBusyId(template.id)
    setError(null)
    dispatchAction('template.delete', { templateId: template.id })
      .then(() => {
        setRemovedIds(prev => new Set(prev).add(template.id))
        setConfirming(null)
      })
      .catch((e: unknown) => {
        setError(
          e instanceof ApiError && e.message
            ? e.message
            : t('template.errors.delete'),
        )
      })
      .finally(() => setBusyId(undefined))
  }

  const { page, searching, query, error: loadError, loadingMore } = discover
  const items = (page?.lectures ?? []).filter(
    template => !removedIds.has(template.id),
  )

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
    if (items.length === 0) {
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(template => (
            <TemplateCard
              key={template.id}
              template={template}
              selected={false}
              onSelect={() => open(template)}
              onDuplicate={duplicate}
              onEdit={
                template.myRole === 'owner' || template.myRole === 'editor'
                  ? edit
                  : undefined
              }
              onDelete={
                template.myRole === 'owner'
                  ? () => setConfirming(template)
                  : undefined
              }
              busyId={busyId}
              showMeta
            />
          ))}
        </div>
        {page.hasMore && (
          <LoadMore onLoadMore={discover.loadMore} loading={loadingMore} />
        )}
      </>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-8">
      <h1 className="mb-4 text-2xl font-bold">{t('templatesPage.heading')}</h1>
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
          onConfirm={() => remove(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  )
}
