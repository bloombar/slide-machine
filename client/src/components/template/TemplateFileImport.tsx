/**
 * Importing a template from a file it was exported to (EXP-3).
 *
 * The other half of `template.export`: a design leaves as a `.template.yaml`
 * and comes back as a template in the library, so a look can be moved between
 * accounts, kept in version control, or restored after it was deleted.
 *
 * ## Why the errors are shown in full
 *
 * A template import refuses rather than substitutes (EXP-3) — there is no
 * default design to fall back to, and handing back something that merely looks
 * close would be worse than saying no. So when the server lists what is wrong
 * with the file, that list is what the instructor sees: "layouts.0.slots:
 * required" is actionable, "import failed" is not. Nothing is created when it
 * refuses, so trying again after an edit is safe.
 *
 * ## A file from disk only
 *
 * The same design kept in the connected Drive arrives by its link, in the one
 * field this panel already has (EXP-3: an upload or a connected account). Two
 * boxes for two links asked the instructor to work out which was which; one
 * box works it out for them, and what is left here is the case a link cannot
 * cover — a file on their own machine.
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload } from 'lucide-react'
import type { Template } from '@slide-machine/shared'
import { dispatchAction } from '../../api/actions'
import { ApiError } from '../../api/http'

export default function TemplateFileImport({
  onImported,
}: {
  /** The new template, so the caller can select it and reload the library. */
  onImported: (template: Template) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  /** Runs an import and reports it, whichever door the file came through. */
  const run = async (action: string, payload: object) => {
    setError(null)
    setBusy(true)
    try {
      onImported(await dispatchAction<Template>(action, payload))
    } catch (err) {
      // The specific problems when the server listed them — a file is fixable
      // and a vague failure is not. Nothing was created either way.
      setError(
        err instanceof ApiError && err.details?.length
          ? t('template.fileImport.errors.invalid', {
              details: err.details.join(' '),
            })
          : t('template.fileImport.errors.failed'),
      )
    } finally {
      setBusy(false)
      // Cleared so picking the same file again still fires a change event,
      // which is how a retry after fixing the file works.
      if (input.current) input.current.value = ''
    }
  }

  const choose = async (file: File) => {
    let content: string
    try {
      content = await file.text()
    } catch {
      setError(t('template.fileImport.errors.read'))
      return
    }
    await run('template.import', { content })
  }

  return (
    <div className="mt-2">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
        <Upload className="h-4 w-4" aria-hidden="true" />
        {busy
          ? t('template.fileImport.working')
          : t('template.fileImport.open')}
        <input
          ref={input}
          type="file"
          accept=".yaml,.yml,application/x-yaml,text/yaml"
          className="sr-only"
          disabled={busy}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) void choose(file)
          }}
        />
      </label>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
