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
import { ApiError } from '../../api/http'
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
  onDirtyChange,
  saveRef,
  onSaved,
}: {
  templates: Template[]
  value: string
  /** Chooses a template. The template itself comes along when the caller
   * cannot yet have it — a fresh duplicate is not in `templates` until the
   * library reloads, and whatever it is applied to should not wait. */
  onChange: (templateId: string, template?: Template) => void
  /** Reloads the library after a template is added, changed or removed. */
  onLibraryChanged: () => void
  /** True while the editor holds unsaved work — nothing here saves by
   * itself, so the settings sheet must not close it away silently. */
  onDirtyChange?: (dirty: boolean) => void
  /** Handed the editor's own save, so a surface asking "close without
   * saving?" can offer to save rather than only to lose the work. */
  saveRef?: React.RefObject<(() => Promise<boolean>) | null>
  /** The template as saved. Editing the one a lecture is using should show
   * on its slides at once — the point of an editor is seeing the effect. */
  onSaved?: (template: Template) => void
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
        // The copy is what the author is now working on, so it is what they
        // are working on it for: chosen straight away, and every change to it
        // from here shows where it is applied.
        onChange(copy.id, copy)
        // Straight into editing: a copy exists to be changed, and its name is
        // the first thing anyone will want to change.
        setEditing(copy)
      })
      .catch(() => setError(t('template.errors.duplicate')))
      .finally(() => setBusyId(undefined))
  }

  /** Opening a template's settings chooses it too: editing a design is done
   * to see it in place, and the editor's own preview is not that. */
  const edit = (template: Template) => {
    setError(null)
    if (template.id !== value) onChange(template.id, template)
    setEditing(template)
  }

  /** Resolves true when the template was written. Callers use that to decide
   * whether it is safe to close: a refused save must not close anything. */
  const save = (draft: {
    name: string
    renderMode: TemplateRenderMode
    theme: Record<string, unknown>
    layouts: Layout[]
    visibility: Template['visibility']
  }): Promise<boolean> => {
    if (!editing) return Promise.resolve(false)
    setSaving(true)
    setError(null)
    return (
      dispatchAction<Template>('template.update', {
        templateId: editing.id,
        ...draft,
      })
        .then(saved => {
          onLibraryChanged()
          onSaved?.(saved)
          setEditing(null)
          return true
        })
        // The server's own words when it has any. A refused save is almost
        // always a specific thing about the design, and "could not be saved"
        // leaves the author nothing to act on.
        .catch((e: unknown) => {
          setError(
            e instanceof ApiError && e.message
              ? e.message
              : t('template.errors.save'),
          )
          return false
        })
        .finally(() => setSaving(false))
    )
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
        onDirtyChange={onDirtyChange}
        saveRef={saveRef}
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
        onEdit={edit}
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
