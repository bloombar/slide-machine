/**
 * The Design tab's template section (TMPL-1/TMPL-4): browse the library,
 * choose a template, and manage the ones you authored.
 *
 * Shared by the project and lecture settings modals so a template is managed
 * the same way wherever it is chosen — the two differ only in what selecting
 * one applies to, which is the caller's business, not this panel's.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  Layout,
  Template,
  TemplateRenderMode,
} from '@slide-machine/shared'
import { dispatchAction } from '../../api/actions'
import { useAuth } from '../../auth/AuthContext'
import { templateName } from '../../i18n/templateName'
import ConfirmDialog from '../ConfirmDialog'
import TemplateLibrary from './TemplateLibrary'
import TemplateEditor from './TemplateEditor'

export default function TemplateDesignPanel({
  templates,
  value,
  onChange,
  onLibraryChanged,
}: {
  templates: Template[]
  value: string
  onChange: (templateId: string) => void
  /** Reloads the library after a template is added, changed or removed. */
  onLibraryChanged: () => void
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [editing, setEditing] = useState<Template | null>(null)
  const [confirming, setConfirming] = useState<Template | null>(null)
  const [busyId, setBusyId] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const duplicate = (template: Template) => {
    setBusyId(template.id)
    setError(null)
    dispatchAction<Template>('template.duplicate', {
      templateId: template.id,
    })
      .then(copy => {
        onLibraryChanged()
        // Straight into editing: a copy exists to be changed, and its name is
        // the first thing anyone will want to change.
        setEditing(copy)
      })
      .catch(() => setError(t('template.errors.duplicate')))
      .finally(() => setBusyId(undefined))
  }

  const save = (draft: {
    name: string
    renderMode: TemplateRenderMode
    theme: Record<string, unknown>
    layouts: Layout[]
    visibility: Template['visibility']
  }) => {
    if (!editing) return
    setSaving(true)
    setError(null)
    dispatchAction<Template>('template.update', {
      templateId: editing.id,
      ...draft,
    })
      .then(() => {
        onLibraryChanged()
        setEditing(null)
      })
      .catch(() => setError(t('template.errors.save')))
      .finally(() => setSaving(false))
  }

  const remove = (template: Template) => {
    setBusyId(template.id)
    setError(null)
    dispatchAction('template.delete', { templateId: template.id })
      .then(() => {
        onLibraryChanged()
        setConfirming(null)
      })
      .catch(() => setError(t('template.errors.delete')))
      .finally(() => setBusyId(undefined))
  }

  if (editing) {
    return (
      <TemplateEditor
        template={editing}
        layoutSources={templates}
        onSave={save}
        onCancel={() => {
          setEditing(null)
          setError(null)
        }}
        saving={saving}
        error={error}
      />
    )
  }

  return (
    <>
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-600">
          {error}
        </p>
      )}
      <TemplateLibrary
        templates={templates}
        value={value}
        onChange={onChange}
        userId={user?.id}
        busyId={busyId}
        onDuplicate={duplicate}
        onEdit={setEditing}
        onDelete={setConfirming}
      />
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
    </>
  )
}
