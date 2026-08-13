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
 * ## Two doors, one room
 *
 * A file from disk and a file kept in the connected Drive are the same file
 * (EXP-3: an import may come from an upload or a connected account). The Drive
 * half takes a pasted link rather than offering a browser, for the reason the
 * Slides import does: the instructor already has it open and its address is in
 * their clipboard.
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileUp } from 'lucide-react'
import type { Template } from '@slide-machine/shared'
import { dispatchAction } from '../../api/actions'
import { ApiError } from '../../api/http'

/**
 * The Drive file id inside whatever the instructor pasted.
 *
 * Mirrors the server's own reading of a link so the field can refuse a
 * non-link before anything is sent — a clear complaint here beats a confusing
 * failure from Google.
 */
export const driveFileIdFrom = (input: string): string | null => {
  const text = input.trim()
  if (!text) return null
  const fromUrl = /\/file\/d\/([a-zA-Z0-9_-]+)/.exec(text)
  if (fromUrl) return fromUrl[1]!
  const fromQuery = /[?&]id=([a-zA-Z0-9_-]+)/.exec(text)
  if (fromQuery) return fromQuery[1]!
  return /^[a-zA-Z0-9_-]{10,}$/.test(text) ? text : null
}

export default function TemplateFileImport({
  onImported,
}: {
  /** The new template, so the caller can select it and reload the library. */
  onImported: (template: Template) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const fileId = driveFileIdFrom(link)

  /** Runs an import and reports it, whichever door the file came through. */
  const run = async (action: string, payload: object) => {
    setError(null)
    setBusy(true)
    try {
      onImported(await dispatchAction<Template>(action, payload))
      setLink('')
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

  const fromDrive = (event: React.FormEvent) => {
    event.preventDefault()
    if (!fileId || busy) return
    void run('template.importFromDrive', { fileId })
  }

  return (
    <div className="mt-2">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
        <FileUp className="h-4 w-4" aria-hidden="true" />
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

      {/* The same file, kept in Drive instead of on disk (EXP-3/EXP-4). */}
      <form onSubmit={fromDrive} className="mt-2 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="template-drive-link">
          {t('template.fileImport.driveLabel')}
        </label>
        <input
          id="template-drive-link"
          type="text"
          value={link}
          onChange={e => setLink(e.target.value)}
          placeholder={t('template.fileImport.drivePlaceholder')}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={!fileId || busy}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-50"
        >
          {t('template.fileImport.driveSubmit')}
        </button>
      </form>
      {/* Said only once something has been typed, so an empty field is not a
          mistake the instructor has not made yet. */}
      {link.trim() && !fileId && (
        <p className="mt-1 text-xs text-slate-500">
          {t('template.fileImport.errors.link')}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
