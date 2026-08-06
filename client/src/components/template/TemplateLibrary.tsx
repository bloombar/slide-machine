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
 */
import { useTranslation } from 'react-i18next'
import { Copy, Pencil, Trash2 } from 'lucide-react'
import type { Template } from '@slide-machine/shared'
import { templateName } from '../../i18n/templateName'
import TemplatePreview from './TemplatePreview'

/** A template the signed-in user authored, rather than one that shipped. */
export const isOwnTemplate = (template: Template, userId?: string): boolean =>
  Boolean(userId) && template.ownerId === userId

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
        return (
          <div key={template.id} className="flex flex-col gap-1.5">
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(template.id)}
              className={`overflow-hidden rounded-lg border-2 p-1 text-start transition-colors ${
                selected
                  ? 'border-indigo-600'
                  : 'border-slate-200 hover:border-slate-400'
              }`}
            >
              <TemplatePreview template={template} />
              <span className="mt-1.5 flex items-center gap-1.5 px-1 pb-0.5">
                <span className="min-w-0 truncate text-sm font-medium">
                  {name}
                </span>
                {own && (
                  <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[0.65rem] font-medium text-slate-600">
                    {t('template.custom')}
                  </span>
                )}
              </span>
            </button>

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
