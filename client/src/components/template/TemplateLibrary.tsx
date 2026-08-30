/**
 * The browsable style-template library (TMPL-1): every template the user can
 * choose from, each shown as a miniature slide in its own theme rather than a
 * colour swatch, so picking one is a matter of looking at it.
 *
 * The caller's own templates (TMPL-4) sit alongside the built-ins and carry
 * the actions that only make sense for something you authored — rename and
 * retheme, or delete. Any template can be duplicated: that is how a new one
 * is made, so a user always starts from something that already renders.
 *
 * Keeps the radiogroup semantics of the picker it replaces, so choosing a
 * template is still one keyboard-reachable control.
 *
 * A card shows one layout, but a template is a set of them, so each card can
 * be paged through its own layouts in place — seeing what a design does with
 * a list or a two-column slide should not mean leaving the Design tab for the
 * editor, which is read-only for anything you did not author.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Copy, Pencil, Trash2 } from 'lucide-react'
import type { Layout, Template } from '@slide-machine/shared'
import { WHITEBOARD_LAYOUT_TYPE } from '@slide-machine/shared'
import { templateName } from '../../i18n/templateName'
import PreviewCard from './PreviewCard'

/** A template the signed-in user authored, rather than one that shipped. */
export const isOwnTemplate = (template: Template, userId?: string): boolean =>
  Boolean(userId) && template.ownerId === userId

/**
 * The layouts a card pages through. The whiteboard is left out for the reason
 * the editor's rail leaves it out (TMPL-7): every template has one, it cannot
 * be given boxes, and it would page to a blank slate.
 */
const steppableLayouts = (template: Template): Layout[] =>
  (template.layouts ?? []).filter(l => l.type !== WHITEBOARD_LAYOUT_TYPE)

/** What a layout is called, matching the editor's rail. */
const layoutLabel = (layout: Layout): string =>
  layout.label.trim() || layout.type

export default function TemplateLibrary({
  templates,
  value,
  onChange,
  userId,
  onDuplicate,
  onEdit,
  onDelete,
  busyId,
}: {
  templates: Template[]
  value: string
  onChange: (id: string) => void
  /** Signed-in user, so their own templates can offer edit and delete. */
  userId?: string
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
        const own = isOwnTemplate(template, userId)
        const selected = value === template.id
        const name = templateName(t, template)
        const steppable = steppableLayouts(template)
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
          <div key={template.id} className="flex flex-col gap-1.5">
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
                {own && (
                  <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[0.65rem] font-medium text-slate-600">
                    {t('template.custom')}
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

            {(onDuplicate || (own && (onEdit || onDelete))) && (
              <div className="flex items-center gap-1 px-1">
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
                {own && onEdit && (
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
                {own && onDelete && (
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
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
