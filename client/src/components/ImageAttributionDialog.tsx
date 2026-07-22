/**
 * Image attribution dialog (IMG-5), opened by the on-slide "i" icon. It
 * shows where an image came from, who to credit, and its license — the full
 * TASL set (Title, Author, Source, License) plus their links, to meet
 * copyright-attribution requirements.
 *
 * Editable images (the instructor's own uploads/seeds) show every field as a
 * form so full credit and license details can be supplied.
 *
 * Read-only images (AI-sourced) show three consolidated, clickable lines
 * rather than separate URL fields:
 *   - Source: links to sourceUrl, labelled by the first available of
 *     title → caption → credit, falling back to the raw URL ("direct link").
 *   - Credit: the creator's name, linking to creatorUrl.
 *   - License: the license name, linking to licenseUrl.
 * A line with no link renders as plain text; links open in a new tab.
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

/**
 * A read-only row: its label plus a value. When `href` is given the value is
 * a hyperlink to it (opening in a new tab); otherwise it is plain text. When
 * only `href` is given, the URL itself is the visible text. Renders nothing
 * when there is neither text nor link.
 */
function ReadRow({
  label,
  text,
  href,
}: {
  label: string
  text?: string
  href?: string
}) {
  const content = text ?? href
  if (!content) return null
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-sm break-all text-indigo-600 hover:underline"
        >
          {content}
        </a>
      ) : (
        <span className="text-sm text-slate-800">{content}</span>
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

  // Read-only images with nothing displayable get a friendly note instead of
  // a list of empty rows. Only the fields the read-only view can render count.
  const hasAny = Boolean(
    attribution?.title ||
    attribution?.caption ||
    attribution?.creator ||
    attribution?.sourceUrl ||
    attribution?.license,
  )

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
              {/* Source: the best available label, linking to the source page.
                  Falls back title → caption → credit → the raw URL itself.
                  Credit is only borrowed as the label when there is a source
                  URL to link it to — otherwise the Credit line already shows
                  it, and it would appear twice. */}
              <ReadRow
                label="Source"
                href={attribution?.sourceUrl}
                text={
                  attribution?.title ??
                  attribution?.caption ??
                  (attribution?.sourceUrl ? attribution?.creator : undefined)
                }
              />
              {/* Credit: the creator's name, linking to their page. */}
              <ReadRow
                label="Credit"
                href={attribution?.creatorUrl}
                text={attribution?.creator}
              />
              {/* License: the license name, linking to its deed. */}
              <ReadRow
                label="License"
                href={attribution?.licenseUrl}
                text={attribution?.license}
              />
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
