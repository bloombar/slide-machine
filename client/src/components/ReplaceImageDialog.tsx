/**
 * Replace-image dialog (EDIT-1). Opened from a slide image's Replace
 * control, it offers three ways to swap the picture: upload a file from
 * the computer, drag-and-drop a file onto the dialog, or search permitted
 * web sources (Wikimedia, Openverse, Flickr) and pick a result. The search
 * seeds itself from the slide's own keywords so the options relate to what
 * the slide is about; choosing a result records its source credit (IMG-5).
 * Mutations are delegated to the parent so the slide updates in place — no
 * page reload — while this dialog only handles search and selection UI.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ImageUp, Search, X } from 'lucide-react'
import type { ImageSearchCandidate } from '@slide-machine/shared'
import { searchSlideImages } from '../api/slides'
import Portal from './Portal'

interface Props {
  slideId: string
  /** Heading/label, already translated by the call site — e.g. "Replace
   * image", or "Add image" for an empty slot. Defaults to the former. */
  title?: string
  /** Pre-filled search terms, derived from the slide by the caller. */
  initialQuery: string
  /** Uploads a chosen/dropped file to set the image. */
  onUpload: (file: File) => void
  /** Applies a web search result as the new image. */
  onPickCandidate: (candidate: ImageSearchCandidate) => void
  onClose: () => void
}

export default function ReplaceImageDialog({
  slideId,
  title,
  initialQuery,
  onUpload,
  onPickCandidate,
  onClose,
}: Props) {
  const { t } = useTranslation()
  const heading = title ?? t('image.replace')
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<ImageSearchCandidate[]>([])
  // Starts true: the dialog searches once on open, so the loading state
  // shows immediately without a synchronous setState in the mount effect.
  const [searching, setSearching] = useState(true)
  const [searched, setSearched] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Escape closes, matching the other dialogs
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Fetches results and records them. Every state update lands after the
  // await, so this is safe to kick off from the mount effect below —
  // nothing sets state synchronously inside an effect body.
  const fetchAndSet = useCallback(
    async (term: string) => {
      try {
        setResults(await searchSlideImages(slideId, term))
      } catch {
        // A failed search just shows the empty state; the person can retry
        setResults([])
      } finally {
        setSearching(false)
        setSearched(true)
      }
    },
    [slideId],
  )

  // Search once on open so options appear without an extra click. The
  // fetch is inlined here (rather than calling fetchAndSet) so no setState
  // runs synchronously in the effect body — updates land only in the
  // promise callbacks, matching the deck-load pattern elsewhere.
  useEffect(() => {
    let active = true
    searchSlideImages(slideId, initialQuery)
      .then(r => {
        if (active) setResults(r)
      })
      .catch(() => {
        if (active) setResults([])
      })
      .finally(() => {
        if (!active) return
        setSearching(false)
        setSearched(true)
      })
    return () => {
      active = false
    }
  }, [slideId, initialQuery])

  const takeFile = (file?: File | null) => {
    if (!file) return
    onUpload(file)
    onClose()
  }

  const pick = (candidate: ImageSearchCandidate) => {
    onPickCandidate(candidate)
    onClose()
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
          aria-label={heading}
          className="relative flex max-h-[calc(100vh-4rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
        >
          <header className="flex items-start justify-between p-6 pb-4">
            <div>
              <h2 className="text-xl font-bold">{heading}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {t('image.search.intro')}
              </p>
            </div>
            <button
              aria-label={t('common.close')}
              onClick={onClose}
              className="rounded p-1 text-slate-400 hover:text-slate-700"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
          </header>

          <div className="flex flex-col gap-5 overflow-y-auto px-6 pb-6">
            {/* Upload / drag-and-drop */}
            <div
              onDragOver={(e: ReactDragEvent) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e: ReactDragEvent) => {
                e.preventDefault()
                setDragOver(false)
                takeFile(e.dataTransfer.files?.[0])
              }}
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center ${
                dragOver
                  ? 'border-indigo-400 bg-indigo-50'
                  : 'border-slate-300 bg-slate-50'
              }`}
            >
              <ImageUp className="h-6 w-6 text-slate-400" aria-hidden />
              <p className="text-sm text-slate-600">
                {t('image.search.drop')}
                <button
                  onClick={() => inputRef.current?.click()}
                  className="ms-1 font-medium text-indigo-600 hover:underline"
                >
                  {t('image.search.upload')}
                </button>
              </p>
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label={t('image.search.uploadLabel')}
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  takeFile(file)
                }}
              />
            </div>

            {/* Web search */}
            <form
              onSubmit={e => {
                e.preventDefault()
                setSearching(true)
                void fetchAndSet(query)
              }}
              className="flex gap-2"
            >
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                aria-label={t('image.search.label')}
                placeholder={t('image.search.placeholder')}
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="submit"
                className="flex items-center gap-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                <Search className="h-4 w-4" aria-hidden />
                {t('image.search.action')}
              </button>
            </form>

            {searching ? (
              <p className="py-8 text-center text-sm text-slate-500">
                {t('image.search.searching')}
              </p>
            ) : results.length ? (
              <ul
                aria-label={t('image.search.results')}
                className="grid grid-cols-2 gap-3 sm:grid-cols-3"
              >
                {results.map(candidate => (
                  <li key={candidate.url}>
                    <button
                      onClick={() => pick(candidate)}
                      aria-label={t('image.search.use', {
                        name: candidate.title || candidate.source,
                      })}
                      className="group relative block aspect-video w-full overflow-hidden rounded-md border border-slate-200 hover:border-indigo-400 hover:ring-2 hover:ring-indigo-200"
                    >
                      <img
                        src={candidate.url}
                        alt={candidate.title || t('image.search.result')}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute inset-x-0 bottom-0 bg-black/50 px-1.5 py-0.5 text-start text-[10px] text-white capitalize">
                        {candidate.source}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              searched && (
                <p className="py-8 text-center text-sm text-slate-500">
                  {t('image.search.none')}
                </p>
              )
            )}
          </div>
        </div>
      </div>
    </Portal>
  )
}
