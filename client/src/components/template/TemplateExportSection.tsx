/**
 * The Design tab's export section (EXP-2 / EXP-6): one design, three
 * destinations — a YAML file this app reads back, a PowerPoint deck a
 * colleague reads, or a Google Slides presentation in Drive to keep working
 * in.
 *
 * Shared by the lecture, project and account Design tabs so a design is
 * exported the same way wherever it is chosen. Everything here is scoped to a
 * template id and nothing else, which is why it can be: the lecture that
 * opened the tab is not part of what gets written.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import type {
  DriveFolder,
  ExportDownload,
  ExportToDriveResult,
} from '@slide-machine/shared'
import { dispatchAction } from '../../api/actions'
import { ApiError } from '../../api/http'
import { apiErrorMessage } from '../../i18n/apiError'
import { downloadExport } from '../../lib/download'
import DrivePicker from '../DrivePicker'

export default function TemplateExportSection({
  templateId,
}: {
  /** The design to export. */
  templateId: string
}) {
  const { t } = useTranslation()
  const [pickingFolder, setPickingFolder] = useState(false)
  const [slidesBusy, setSlidesBusy] = useState(false)
  const [slidesError, setSlidesError] = useState<string | null>(null)
  const [slidesSaved, setSlidesSaved] = useState<ExportToDriveResult | null>(
    null,
  )

  /** Downloads the design as a re-importable YAML file, or as PPTX. */
  const exportTemplate = (format?: 'pptx') => {
    setSlidesError(null)
    dispatchAction<ExportDownload>('template.export', {
      templateId,
      ...(format ? { format } : {}),
    })
      .then(downloadExport)
      .catch((err: Error) => {
        // Said rather than swallowed. A quiet failure here is indistinguishable
        // from a button that does nothing, which is how this last went wrong:
        // the export was refused and the screen reported it by staying still.
        setSlidesError(apiErrorMessage(err, t, 'template.exportYamlError'))
      })
  }

  /**
   * Saves the design to Drive as a Google Slides presentation whose layouts
   * are its layouts (EXP-6). A template in Slides is nothing more than that,
   * so this is what "export a template" has to mean there.
   */
  const exportTemplateToDrive = (folder: DriveFolder) => {
    setSlidesBusy(true)
    setSlidesError(null)
    dispatchAction<ExportToDriveResult>('template.exportToDrive', {
      templateId,
      driveFolderId: folder.id,
      driveFolderName: folder.name,
    })
      .then(res => {
        setSlidesSaved(res)
        setPickingFolder(false)
      })
      .catch(err => {
        // A missing Google connection is the one failure the user can act on
        setSlidesError(
          err instanceof ApiError && err.status === 403
            ? t('template.exportSlidesConnect')
            : t('template.exportSlidesError'),
        )
      })
      .finally(() => setSlidesBusy(false))
  }

  return (
    <div className="mt-6 border-t border-slate-100 pt-4">
      <h3 className="text-sm font-medium text-slate-700">
        {t('template.exportHeading')}
      </h3>
      <p className="mt-1 mb-3 text-xs text-slate-500">
        {t('template.exportHint')}
      </p>

      {pickingFolder ? (
        <DrivePicker
          kind="folder"
          title={t('export.folder.title', {
            format: t('template.exportToSlides'),
          })}
          confirmLabel={t('export.saveHere')}
          busyLabel={t('export.saving')}
          busy={slidesBusy}
          onCancel={() => setPickingFolder(false)}
          onPick={exportTemplateToDrive}
          onReconnect={() => setPickingFolder(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => exportTemplate()}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            {t('template.exportAsYaml')}
          </button>
          {/* The design as a deck anyone can open, its layouts the slides.
              YAML is what this app reads back; this is what a colleague
              reads. */}
          <button
            type="button"
            onClick={() => exportTemplate('pptx')}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            {t('template.exportAsPptx')}
          </button>
          <button
            type="button"
            onClick={() => {
              setSlidesSaved(null)
              setSlidesError(null)
              setPickingFolder(true)
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" aria-hidden />
            {t('template.exportToSlides')}
          </button>
        </div>
      )}

      {slidesSaved && (
        <p role="status" className="mt-2 text-xs">
          <a
            href={slidesSaved.fileUrl}
            target="_blank"
            rel="noreferrer"
            className="text-indigo-600 hover:underline"
          >
            {t('template.exportSlidesDone')}
          </a>
        </p>
      )}
      {slidesError && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {slidesError}
        </p>
      )}
    </div>
  )
}
