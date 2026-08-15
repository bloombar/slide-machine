/**
 * The Design tab's template section (TMPL-1/TMPL-4): browse the library,
 * choose a template, and manage the ones you authored.
 *
 * Shared by the project and lecture settings modals so a template is managed
 * the same way wherever it is chosen — the two differ only in what selecting
 * one applies to, which is the caller's business, not this panel's.
 *
 * Editing happens away from here, on the template's own page (`/t/:slug`): a
 * design belongs to its author, not to the lecture that opened the tab, and
 * it outlives any of them. Duplicating and deleting stay here, beside the
 * library they change. Whatever the author starts working on is applied
 * first, so the lecture they came from is already wearing it when they get
 * back.
 */
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { Template } from '@slide-machine/shared'
import { dispatchAction } from '../../api/actions'
import { useAuth } from '../../auth/AuthContext'
import { templateName } from '../../i18n/templateName'
import ConfirmDialog from '../ConfirmDialog'
import TemplateLibrary from './TemplateLibrary'
import TemplateImport from './TemplateImport'
import TemplateFileImport from './TemplateFileImport'

export default function TemplateDesignPanel({
  templates,
  value,
  onChange,
  onLibraryChanged,
}: {
  templates: Template[]
  value: string
  /** Chooses a template. The template itself comes along when the caller
   * cannot yet have it — a fresh duplicate is not in `templates` until the
   * library reloads, and whatever it is applied to should not wait. */
  onChange: (templateId: string, template?: Template) => void
  /** Reloads the library after a template is added, changed or removed. */
  onLibraryChanged: () => void
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [confirming, setConfirming] = useState<Template | null>(null)
  const [busyId, setBusyId] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)

  /** Opens a template's own page, remembering where the author came from so
   * it can offer the way back. */
  const open = (template: Template) => {
    void navigate(`/t/${template.permalinkSlug}`, {
      state: { from: location.pathname },
    })
  }

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
        open(copy)
      })
      .catch(() => setError(t('template.errors.duplicate')))
      .finally(() => setBusyId(undefined))
  }

  /** Opening a template's settings chooses it too: editing a design is done
   * to see it in place, and the editor's own preview is not that. */
  const edit = (template: Template) => {
    setError(null)
    if (template.id !== value) onChange(template.id, template)
    open(template)
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
      {/* One way in, three sources. A design arriving from Slides, from a file
          this app wrote earlier, or from Drive is the same event to the
          library, so the tab offers one button rather than three controls. */}
      <TemplateImport
        onImported={imported => {
          onLibraryChanged()
          // Chosen straight away, the way a fresh duplicate is: an import
          // exists to be used, and seeing it in place is how it gets reviewed.
          onChange(imported.id, imported)
        }}
        otherSources={
          <TemplateFileImport
            onImported={imported => {
              onLibraryChanged()
              onChange(imported.id, imported)
            }}
          />
        }
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
