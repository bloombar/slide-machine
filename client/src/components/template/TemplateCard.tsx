/**
 * One template, drawn as a miniature slide with a paged layout run and an
 * icon row (TMPL-1/TMPL-27/TMPL-28): the body every card shares, whether it
 * sits in the Design tab's picker (`TemplateLibrary`, which wraps it in the
 * radiogroup and the selection it needs) or in the full-page library
 * (`/app/templates`, which never selects a card — clicking one opens the
 * design's own page instead).
 *
 * `showMeta` is the one visible difference between the two: the Design
 * Templates page has room for a byline, a layout count and a description
 * below the thumbnail (TMPL-28) that the Design tab's tighter grid does not
 * ask for and must not gain by accident.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight, Copy, Pencil, Trash2 } from 'lucide-react'
import type { Layout, Template, VoteResult } from '@slide-machine/shared'
import { steppableLayouts } from '@slide-machine/shared'
import { templateName } from '../../i18n/templateName'
import { displayHandle } from '../../lib/handle'
import VoteControl from '../VoteControl'
import VoteCount from '../discover/VoteCount'
import PreviewCard from './PreviewCard'

/** What a layout is called, matching the editor's rail. */
const layoutLabel = (layout: Layout): string =>
  layout.label.trim() || layout.type

export default function TemplateCard({
  template,
  selected = false,
  onSelect,
  linkTo,
  onDuplicate,
  onEdit,
  onDelete,
  busyId,
  onVote,
  showMeta = false,
}: {
  template: Template
  /** Ignored when `linkTo` is given. */
  selected?: boolean
  onSelect?: () => void
  /** Opens the design's own page as a link instead of selecting it
   * (TMPL-28) — see `PreviewCard`'s own doc comment for why a link, not a
   * radio, is what the Design Templates page's card needs. */
  linkTo?: { to: string; state?: unknown }
  onDuplicate?: (template: Template) => void
  onEdit?: (template: Template) => void
  onDelete?: (template: Template) => void
  /** Template currently being duplicated or deleted; its actions are held. */
  busyId?: string
  /** Every settled vote (TMPL-27), so a caller holding its own copy of the
   * template can patch it (e.g. `useDiscover`'s `patch`) and
   * keep the vote past a remount of whatever drew this card. */
  onVote?: (templateId: string, result: VoteResult) => void
  /** Renders the creator, layout count and description below the thumbnail
   * (TMPL-28) — the Design Templates page's own grid, which has room for
   * it; omitted (the default) keeps the Design tab's card exactly as it was. */
  showMeta?: boolean
}) {
  const { t } = useTranslation()
  // Which of the template's own layouts is on screen, local to this one
  // card: paging one card must never move another, and a card mounted under
  // a stable `key={template.id}` (both callers use one) keeps this across a
  // re-render the same way a keyed-by-id map in the parent used to.
  const [at, setAt] = useState(0)

  const canEdit = template.myRole === 'owner' || template.myRole === 'editor'
  const canDelete = template.myRole === 'owner'
  const shared = template.myRole === 'editor' || template.myRole === 'viewer'
  const name = templateName(t, template)
  const votes = template.votes ?? { up: 0, down: 0, myVote: 0 }
  const steppable = steppableLayouts(template.layouts)
  // Starts at the design's first layout, so paging reads as a run through
  // the template in the order it declares them rather than starting
  // somewhere in the middle of it.
  const shown = steppable[at]
  // Wraps, so neither arrow is ever a dead control.
  const step = (by: number) =>
    setAt(a => (a + by + steppable.length) % steppable.length)
  const pageable = steppable.length > 1

  return (
    <div
      // A stable hook to scope a test (or a future feature) to this one
      // card, rather than to `PreviewCard`'s own control — the vote row
      // below is that control's sibling, not its descendant, so a
      // `.closest('[role="radio"]')`-style lookup (or, in link mode, a
      // lookup off the anchor) misses it entirely.
      data-template-card={template.id}
      className="flex flex-col gap-1.5"
    >
      {/* The arrows sit over the end of the name row rather than in it: the
          row is inside `PreviewCard`'s own radio-or-link, and neither can
          hold another interactive element inside it. Same arrangement as
          the editor rail's delete icon. */}
      <div className="relative">
        <PreviewCard
          template={template}
          layout={shown}
          selected={selected}
          onSelect={onSelect}
          linkTo={linkTo}
          captionClassName={`flex items-center gap-1.5 ${
            pageable ? 'pr-20' : ''
          }`}
        >
          <span className="min-w-0 truncate text-sm font-medium">{name}</span>
          {template.myRole === 'owner' && (
            <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[0.65rem] font-medium text-slate-600">
              {t('template.custom')}
            </span>
          )}
          {/* Shared with the caller (TMPL-26), rather than authored by them —
              distinct from "Custom" so a card never claims both at once. */}
          {shared && (
            <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[0.65rem] font-medium text-indigo-700">
              {t('template.shared')}
            </span>
          )}
        </PreviewCard>

        {pageable && (
          <div className="absolute bottom-1 right-1.5 flex items-center gap-0.5">
            {/* Decoration: the arrows are named, and the live region below
                says which layout the card landed on. */}
            <span
              aria-hidden
              className="text-[0.65rem] tabular-nums text-slate-500"
            >
              {t('template.layoutPosition', {
                index: at + 1,
                total: steppable.length,
              })}
            </span>
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label={t('template.previousLayout', { name })}
              title={t('template.previousLayout', { name })}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label={t('template.nextLayout', { name })}
              title={t('template.nextLayout', { name })}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
            {/* The preview is decoration to a screen reader, so paging it
                would otherwise announce nothing at all. */}
            <span className="sr-only" aria-live="polite">
              {shown ? layoutLabel(shown) : ''}
            </span>
          </div>
        )}
      </div>

      {/* Room for a byline and a description (TMPL-28), on the full library
          page only. `template.owner` is `null` for a built-in and `undefined`
          only when the caller never asked for it — neither carries a name to
          link to, so both are simply skipped rather than one standing in
          for "built-in" and the other for "unknown". Guarded on
          `displayName` too, not merely on `owner` existing: an owner record
          with nothing to show (a deleted account) must not render a link
          with no visible text, which would still be focusable and read
          nothing to a screen reader. */}
      {showMeta && (
        <div className="px-1 text-xs text-slate-500">
          {template.owner?.displayName && (
            <Link
              to={`/u/${template.owner.id}`}
              className="block truncate font-medium hover:text-indigo-600"
            >
              {displayHandle(template.owner.displayName)}
            </Link>
          )}
          <p>
            {t('templatesPage.layoutCount', {
              count: template.layoutCount ?? 0,
            })}
          </p>
          {template.description && (
            <p className="mt-0.5 line-clamp-2">{template.description}</p>
          )}
        </div>
      )}

      {/* The row always renders (TMPL-27): every card carries a vote control
          or, for the caller's own, a read-only tally, at its right-hand end,
          even when none of duplicate/edit/delete apply. `flex-wrap` lets the
          vote drop to its own line at a narrow width rather than overflow
          the row; `ml-auto` still pushes it to the right whichever line it
          lands on. */}
      <div className="flex flex-wrap items-center gap-1 px-1">
        {onDuplicate && (
          <button
            type="button"
            onClick={() => onDuplicate(template)}
            disabled={busyId === template.id}
            aria-label={t('template.duplicateNamed', { name })}
            title={t('template.duplicate')}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        {canEdit && onEdit && (
          <button
            type="button"
            onClick={() => onEdit(template)}
            aria-label={t('template.editNamed', { name })}
            title={t('template.edit')}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        {canDelete && onDelete && (
          <button
            type="button"
            onClick={() => onDelete(template)}
            disabled={busyId === template.id}
            aria-label={t('template.deleteNamed', { name })}
            title={t('common.delete')}
            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
        {/* Right-most in the row, pushed clear of the icons before it
            (TMPL-27). The caller's own template shows the tally everyone
            else sees on a lecture they own, rather than buttons to vote on
            their own work; anything else, built-ins included, is voteable. */}
        {template.myRole === 'owner' ? (
          <VoteCount
            up={votes.up}
            down={votes.down}
            size="compact"
            className="ml-auto"
          />
        ) : (
          <VoteControl
            target={{ kind: 'template', id: template.id }}
            name={name}
            up={votes.up}
            down={votes.down}
            myVote={votes.myVote}
            size="compact"
            className="ml-auto"
            onChange={res => onVote?.(template.id, res)}
          />
        )}
      </div>
    </div>
  )
}
