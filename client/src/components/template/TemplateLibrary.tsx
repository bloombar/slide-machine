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
 * template is still one keyboard-reachable control — the one thing this
 * component keeps for itself rather than sharing: a card's own body (the
 * preview, its layout paging, and the icon row) lives in `TemplateCard`,
 * shared with the full Design Templates page (`/app/templates`, TMPL-28),
 * which never selects a card this way.
 */
import { useTranslation } from 'react-i18next'
import type { Template, VoteResult } from '@slide-machine/shared'
import TemplateCard from './TemplateCard'

export default function TemplateLibrary({
  templates,
  value,
  onChange,
  onDuplicate,
  onEdit,
  onDelete,
  busyId,
  onVote,
}: {
  templates: Template[]
  value: string
  onChange: (id: string) => void
  onDuplicate?: (template: Template) => void
  onEdit?: (template: Template) => void
  onDelete?: (template: Template) => void
  /** Template currently being duplicated or deleted; its actions are held. */
  busyId?: string
  /** Every settled vote (TMPL-27). This list is only a snapshot the caller
   * fetched: a caller keeping its own `templates` must patch it, or the vote
   * reverts when the Design tab that drew these cards unmounts and remounts
   * (a tab switch, a settings modal reopened). */
  onVote?: (templateId: string, result: VoteResult) => void
}) {
  const { t } = useTranslation()

  return (
    <div
      role="radiogroup"
      aria-label={t('template.label')}
      className="grid grid-cols-2 gap-4 sm:grid-cols-3"
    >
      {templates.map(template => (
        <TemplateCard
          key={template.id}
          template={template}
          selected={value === template.id}
          onSelect={() => onChange(template.id)}
          onDuplicate={onDuplicate}
          onEdit={onEdit}
          onDelete={onDelete}
          busyId={busyId}
          onVote={onVote}
        />
      ))}
    </div>
  )
}
