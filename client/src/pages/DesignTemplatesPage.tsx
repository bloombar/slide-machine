/**
 * Every design template on a page of its own (TMPL-28), at `/app/templates`:
 * built-ins and public designs by Latest or Top, or the caller's own library
 * ("Mine" — owned or shared with them) by "Mine", with a search box and
 * infinite scroll — `TemplateBrowser`'s own link mode, shared with the
 * Design tab's select mode (`TemplateDesignPanel`) rather than forked.
 *
 * This page owns only what is its own: the heading, the explanation of what
 * a design template is for, and the Import control. Everything below —
 * the controls, the grid, duplicate/edit/delete/vote, infinite scroll —
 * lives in `TemplateBrowser`.
 */
import { useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { TemplateFeedSort } from '@slide-machine/shared'
import { useRef } from 'react'
import TemplateBrowser, {
  type TemplateBrowserHandle,
} from '../components/template/TemplateBrowser'
import TemplateImportControl from '../components/template/TemplateImportControl'

export default function DesignTemplatesPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const browser = useRef<TemplateBrowserHandle>(null)
  // Coming back from a design the caller owns (TMPL-28) lands on "Mine",
  // where that design actually lives — `TemplateEditorPage`'s Back sets this
  // rather than the URL, since nothing else here needs the sort in the
  // address bar. Any other value, or none, keeps the page's own default.
  const initialSort: TemplateFeedSort =
    (location.state as { sort?: TemplateFeedSort } | null)?.sort === 'mine'
      ? 'mine'
      : 'latest'

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6 sm:py-8">
      {/* Import behaves exactly as it does on the Design tab (TMPL-28): the
          same shared control, opening in a dialog rather than a settings
          form this page does not have, staying open with its own report
          rather than navigating away underneath it. There is nothing here
          to apply the import to the way the Design tab's picker does, so
          the page switches to Mine instead — where the new design actually
          lives — and clears any search, which would otherwise go on hiding
          a design that does not happen to match it (round 2). Switching
          sort or clearing the query, whichever actually changes, already
          makes the page-one effect refetch on its own; `refresh()` only
          covers the one case neither does — already on Mine with no search
          active, where nothing about this action changes either input the
          effect watches. An "Open design" action in the dialog itself is
          the way from here to the new design's own page, the same one the
          Design tab's copy gets from `TemplateImportControl`. */}
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t('templatesPage.heading')}</h1>
        <TemplateImportControl onImported={() => browser.current?.showMine()} />
      </div>
      {/* What a design template is for (TMPL-28): plain enough that a first-time
          visitor knows why a page of these exists before browsing them. */}
      <p className="mt-2 mb-4 text-sm text-slate-600">
        {t('templatesPage.explanation')}
      </p>
      <TemplateBrowser
        ref={browser}
        mode="link"
        initialSort={initialSort}
        linkState={{ from: '/app/templates' }}
      />
    </div>
  )
}
