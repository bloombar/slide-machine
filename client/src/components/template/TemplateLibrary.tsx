/**
 * The browsable style-template library (TMPL-1): every template the user can
 * choose from, each shown as a miniature slide in its own theme rather than a
 * colour swatch, so picking one is a matter of looking at it.
 *
 * The caller's own templates (TMPL-4) sit alongside the built-ins and carry
 * the actions that only make sense for something you authored — rename and
 * retheme, or delete. A design someone else shared as editor (TMPL-26) gets
 * the same edit action, since `template.update` accepts either; delete stays
 * owner-only regardless. Any template can be duplicated: that is how a new
 * one is made, so a user always starts from something that already renders.
 *
 * Keeps the radiogroup semantics of the picker it replaces, so choosing a
 * template is still one keyboard-reachable control.
 *
 * A card shows one layout, but a template is a set of them, so each card can
 * be paged through its own layouts in place — seeing what a design does with
 * a list or a two-column slide should not mean leaving the Design tab for the
 * editor, which is read-only for anything you did not author.
 *
 * Every card also carries a vote (TMPL-27), right-most in the icon row: a
 * built-in or someone else's design gets the up/down buttons, and the
 * caller's own gets a read-only tally instead, the same trade a lecture's
 * viewer makes for its owner. The cast vote itself lives inside
 * `VoteControl`, which keeps it across a stale re-render on its own (it
 * only re-adopts `template.votes` once nothing is in flight) — this
 * component just passes the current `votes` straight through.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Copy, Pencil, Trash2 } from 'lucide-react'
import type { Layout, Template } from '@slide-machine/shared'
import { steppableLayouts } from '@slide-machine/shared'
import { templateName } from '../../i18n/templateName'
import VoteControl from '../VoteControl'
import VoteCount from '../discover/VoteCount'
import PreviewCard from './PreviewCard'

/** What a layout is called, matching the editor's rail. */
const layoutLabel = (layout: Layout): string =>
  layout.label.trim() || layout.type

export default function TemplateLibrary({
  templates,
  value,
  onChange,
  onDuplicate,
  onEdit,
  onDelete,
  busyId,
}: {
  templates: Template[]
  value: string
  onChange: (id: string) => void
  onDuplicate?: (template: Template) => void
  onEdit?: (template: Template) => void
  onDelete?: (template: Template) => void
  /** Template currently being duplicated or deleted; its actions are held. */
  busyId?: string
}) {
  const { t } = useTranslation()
  // Where each card is in its own run of layouts, by template id, so paging
  // one card leaves the rest of the grid where it was. A card with no entry
  // shows what it always showed.
  const [layoutAt, setLayoutAt] = useState<Record<string, number>>({})

  return (
    <div
      role="radiogroup"
      aria-label={t('template.label')}
      className="grid grid-cols-2 gap-4 sm:grid-cols-3"
    >
      {templates.map(template => {
        // Server-decided roles (TMPL-26), never an `ownerId` comparison the
        // client would have to keep in step with sharing on its own.
        const canEdit =
          template.myRole === 'owner' || template.myRole === 'editor'
        const canDelete = template.myRole === 'owner'
        const shared =
          template.myRole === 'editor' || template.myRole === 'viewer'
        const selected = value === template.id
        const name = templateName(t, template)
        const votes = template.votes ?? { up: 0, down: 0, myVote: 0 }
        const steppable = steppableLayouts(template.layouts)
        // Starts at the design's first layout, so paging reads as a run
        // through the template in the order it declares them rather than
        // starting somewhere in the middle of itself.
        const at = layoutAt[template.id] ?? 0
        const shown = steppable[at]
        // Wraps, so neither arrow is ever a dead control.
        const step = (by: number) =>
          setLayoutAt(m => ({
            ...m,
            [template.id]: (at + by + steppable.length) % steppable.length,
          }))
        const pageable = steppable.length > 1
        return (
          <div
            key={template.id}
            // A stable hook to scope a test (or a future feature) to this
            // one card, rather than to `PreviewCard`'s own radio — the vote
            // row below is that radio's sibling, not its descendant, so
            // `.closest('[role="radio"]')`-style lookups miss it entirely.
            data-template-card={template.id}
            className="flex flex-col gap-1.5"
          >
            {/* The arrows sit over the end of the name row rather than in it:
                the row is inside the radio, and a button cannot hold another
                button. Same arrangement as the editor rail's delete icon. */}
            <div className="relative">
              <PreviewCard
                template={template}
                layout={shown}
                selected={selected}
                onSelect={() => onChange(template.id)}
                captionClassName={`flex items-center gap-1.5 ${
                  pageable ? 'pr-20' : ''
                }`}
              >
                <span className="min-w-0 truncate text-sm font-medium">
                  {name}
                </span>
                {template.myRole === 'owner' && (
                  <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[0.65rem] font-medium text-slate-600">
                    {t('template.custom')}
                  </span>
                )}
                {/* Shared with the caller (TMPL-26), rather than authored by
                    them — distinct from "Custom" so a card never claims
                    both at once. */}
                {shared && (
                  <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[0.65rem] font-medium text-indigo-700">
                    {t('template.shared')}
                  </span>
                )}
              </PreviewCard>

              {pageable && (
                <div className="absolute bottom-1 right-1.5 flex items-center gap-0.5">
                  {/* Decoration: the arrows are named, and the live region
                      below says which layout the card landed on. */}
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
                  {/* The preview is decoration to a screen reader, so paging
                      it would otherwise announce nothing at all. */}
                  <span className="sr-only" aria-live="polite">
                    {shown ? layoutLabel(shown) : ''}
                  </span>
                </div>
              )}
            </div>

            {/* The row always renders now (TMPL-27): every card carries a
                vote control or, for the caller's own, a read-only tally, at
                its right-hand end, even when none of duplicate/edit/delete
                apply. `flex-wrap` lets the vote drop to its own line at a
                narrow width (the Design tab's 2-column grid can get down to
                ~150px a card) rather than overflow the row; `ml-auto` still
                pushes it to the right whichever line it lands on. */}
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
              {/* Right-most in the row, pushed clear of the icons before
                    it (TMPL-27). The caller's own template shows the tally
                    everyone else sees on a lecture they own, rather than
                    buttons to vote on their own work; anything else,
                    built-ins included, is voteable. */}
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
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
