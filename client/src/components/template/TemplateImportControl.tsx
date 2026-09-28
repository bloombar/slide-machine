/**
 * The "Import a design" control (TMPL-8/TMPL-28/TMPL-29): the same button and
 * the same import panel — `TemplateImport` plus `TemplateFileImport` as its
 * other sources — shared by the Design tab and the Design templates page, so
 * a page with no settings form of its own can offer it too.
 *
 * Extracted from `TemplateDesignPanel`, which used to render the panel
 * inline: a page is not a settings sheet, and there is nowhere inline for it
 * to grow into there, so both now open it in a modal dialog instead.
 *
 * Left open after a successful import rather than closing underneath it: the
 * import's own report is the point of the screen after (`TemplateImport`'s
 * own doc comment), and closing on success would hide it the instant it
 * appeared. The caller still hears about the new template right away, for
 * whatever "just imported one" means to it — closing the dialog is a
 * separate, deliberate step the author takes once they are done reading.
 *
 * An "Open design" action appears once the import lands, alongside the
 * report — for a caller with nothing of its own to apply the import to
 * (the Design templates page, TMPL-28), this is the only way in from here
 * to the new design's own page; a caller that already applies it in place
 * (the Design tab) can use it just as well to jump straight to editing.
 */
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Upload, X } from 'lucide-react'
import type { Template } from '@slide-machine/shared'
import Modal from '../Modal'
import TemplateImport from './TemplateImport'
import TemplateFileImport from './TemplateFileImport'

export default function TemplateImportControl({
  onImported,
}: {
  /** The new template, so the caller can select it, reload its library, or
   * navigate to it — whatever "having just imported one" means there. */
  onImported: (template: Template) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  // The design an import just produced, kept only for the "Open design"
  // action below — cleared whenever the dialog (re)opens, so a stale one
  // from a previous visit can never show before this one has imported
  // anything of its own.
  const [imported, setImported] = useState<Template | null>(null)

  const openDialog = () => {
    setImported(null)
    setOpen(true)
  }

  const handleImported = (template: Template) => {
    setImported(template)
    onImported(template)
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        {t('template.import.open')}
      </button>
      {open && (
        <Modal
          onClose={() => setOpen(false)}
          ariaLabel={t('template.import.open')}
          size="md"
        >
          <header className="mb-3 flex items-start justify-between">
            <h2 className="text-lg font-bold">{t('template.import.open')}</h2>
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={() => setOpen(false)}
              className="rounded-md p-2 text-slate-500 hover:text-slate-900"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </header>
          <TemplateImport
            alwaysOpen
            onRequestClose={() => setOpen(false)}
            onImported={handleImported}
            otherSources={<TemplateFileImport onImported={handleImported} />}
          />
          {imported && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  void navigate(`/t/${imported.permalinkSlug}`, {
                    state: { from: location.pathname },
                  })
                }}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white"
              >
                {t('template.import.openDesign')}
              </button>
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
