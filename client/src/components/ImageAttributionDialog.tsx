/**
 * Image attribution dialog (IMG-5), opened by the on-slide "i" icon. It
 * shows where an image came from, who to credit, and its license — the full
 * TASL set (Title, Author, Source, License) plus their links, to meet
 * copyright-attribution requirements.
 *
 * Editable images (the instructor's own uploads/seeds) show every field as a
 * form so full credit and license details can be supplied. Read-only images
 * (AI-sourced) show only the fields that actually carry data. Source and
 * license links open in a new tab.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import type { ImageAttribution } from '@slide-machine/shared'
import Portal from './Portal'

interface Props {
  attribution?: ImageAttribution
  /** True for the user's own images (uploaded/seeded): they get the editable
   * form with all fields. AI-sourced images are read-only. */
  editable: boolean
  onSave: (attribution: ImageAttribution) => void
  onClose: () => void
}

/** Every attribution field, in display order, with its form label. */
const FIELDS: {
  key: keyof ImageAttribution
  label: string
  placeholder: string
}[] = [
  { key: 'title', label: 'Title', placeholder: 'Title of the work' },
  { key: 'caption', label: 'Caption', placeholder: 'Short description' },
  { key: 'creator', label: 'Credit', placeholder: 'Author or creator' },
  { key: 'creatorUrl', label: 'Creator URL', placeholder: 'https://…' },
  { key: 'sourceName', label: 'Source', placeholder: 'e.g. Wikimedia Commons' },
  { key: 'sourceUrl', label: 'Source URL', placeholder: 'https://…' },
  { key: 'license', label: 'License', placeholder: 'e.g. CC BY 4.0' },
  { key: 'licenseUrl', label: 'License URL', placeholder: 'https://…' },
]

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
  const [form, setForm] = useState<ImageAttribution>(() => ({ ...attribution }))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Read-only images with nothing recorded get a friendly note instead of
  // a list of empty rows.
  const hasAny = FIELDS.some(f => attribution?.[f.key])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const cleaned: ImageAttribution = {}
    for (const { key } of FIELDS) {
      cleaned[key] = form[key]?.trim() || undefined
    }
    onSave(cleaned)
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
        <div
          aria-hidden
          onClick={onClose}
          className="absolute inset-0 bg-black/30"
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image details"
          className="relative max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
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
              {FIELDS.map(({ key, label, placeholder }) => (
                <label
                  key={key}
                  className="flex flex-col gap-1 text-sm text-slate-700"
                >
                  {label}
                  <input
                    value={form[key] ?? ''}
                    onChange={e =>
                      setForm(prev => ({ ...prev, [key]: e.target.value }))
                    }
                    placeholder={placeholder}
                    className="rounded-md border border-slate-300 px-3 py-2"
                  />
                </label>
              ))}
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
              {FIELDS.map(({ key, label }) => (
                <ReadRow key={key} label={label} value={attribution?.[key]} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              No source or licensing information is recorded for this image.
            </p>
          )}
        </div>
      </div>
    </Portal>
  )
}
