/**
 * Image attribution dialog (IMG-5), opened by the on-slide "i" icon. It
 * shows where an image came from, who to credit, and its license. Viewers
 * see it read-only; owners/editors get a form to correct or supply the
 * details (crediting is often a license requirement). Source and license
 * links open in a new tab.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import type { ImageAttribution } from '@slide-machine/shared'

interface Props {
  attribution?: ImageAttribution
  /** Owners get the editable form; everyone else sees it read-only. */
  editable: boolean
  onSave: (attribution: ImageAttribution) => void
  onClose: () => void
}

/** Shows a value, linking it when it looks like a URL. */
function ReadRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  const isUrl = /^https?:\/\//i.test(value)
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {isUrl ? (
        <a
          href={value}
          target="_blank"
          rel="noreferrer noopener"
          className="text-sm break-all text-indigo-600 hover:underline"
        >
          {value}
        </a>
      ) : (
        <span className="text-sm text-slate-800">{value}</span>
      )}
    </div>
  )
}

export default function ImageAttributionDialog({
  attribution,
  editable,
  onSave,
  onClose,
}: Props) {
  const [sourceUrl, setSourceUrl] = useState(attribution?.sourceUrl ?? '')
  const [author, setAuthor] = useState(attribution?.author ?? '')
  const [license, setLicense] = useState(attribution?.license ?? '')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const hasAny = Boolean(
    attribution?.sourceUrl || attribution?.author || attribution?.license,
  )

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    onSave({
      sourceUrl: sourceUrl.trim() || undefined,
      author: author.trim() || undefined,
      license: license.trim() || undefined,
    })
  }

  const field = (
    label: string,
    value: string,
    setValue: (v: string) => void,
    placeholder: string,
  ) => (
    <label className="flex flex-col gap-1 text-sm text-slate-700">
      {label}
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={placeholder}
        className="rounded-md border border-slate-300 px-3 py-2"
      />
    </label>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Image details"
        className="relative w-full max-w-sm rounded-lg bg-white p-6 shadow-xl"
      >
        <header className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-bold">Image details</h2>
          <button
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:text-slate-700"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        {editable ? (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            {field('Source', sourceUrl, setSourceUrl, 'https://…')}
            {field('Credit', author, setAuthor, 'Author or creator')}
            {field('License', license, setLicense, 'e.g. CC BY 4.0')}
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white"
              >
                Save
              </button>
            </div>
          </form>
        ) : hasAny ? (
          <div className="flex flex-col gap-3">
            <ReadRow label="Source" value={attribution?.sourceUrl} />
            <ReadRow label="Credit" value={attribution?.author} />
            <ReadRow label="License" value={attribution?.license} />
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No source or licensing information is recorded for this image.
          </p>
        )}
      </div>
    </div>
  )
}
