/**
 * Seed material manager (SEED-1/SEED-2), used at both levels: upload
 * PDFs, DOCX, text files, or photos; watch extraction settle (the list
 * polls while anything is processing); edit photo captions (which double as
 * enrichment keywords); toggle assets in or out of generation; delete.
 */
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Image as ImageIcon, Trash2, UploadCloud } from 'lucide-react'
import type { SeedAsset } from '@slide-machine/shared'
import {
  deleteSeedAsset,
  listSeedAssets,
  updateSeedAsset,
  uploadSeedAsset,
} from '../api/seed-assets'

const POLL_MS = 1500
const ACCEPT = '.pdf,.docx,.txt,.md,text/plain,image/png,image/jpeg,image/webp'

function CaptionField({
  asset,
  onSaved,
}: {
  asset: SeedAsset
  onSaved: (asset: SeedAsset) => void
}) {
  const { t } = useTranslation()
  const [caption, setCaption] = useState(asset.caption ?? '')
  const savedRef = useRef(asset.caption ?? '')
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const save = (next: string) => {
    if (next === savedRef.current) return
    savedRef.current = next
    updateSeedAsset({ assetId: asset.id, caption: next })
      .then(onSaved)
      .catch(() => {
        // Quiet failure: the next keystroke retries
      })
  }

  const onChange = (next: string) => {
    setCaption(next)
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => save(next), 800)
  }

  return (
    <input
      value={caption}
      onChange={e => onChange(e.target.value)}
      onBlur={() => {
        window.clearTimeout(timerRef.current)
        save(caption)
      }}
      placeholder={t('seed.captionPlaceholder')}
      aria-label={t('seed.captionFor', { name: asset.name })}
      className="w-full rounded border border-slate-200 px-2 py-1 text-xs"
    />
  )
}

interface Props {
  projectId: string
  /** Present when managing a lecture's own material. */
  deckId?: string
}

export default function SeedMaterial({ projectId, deckId }: Props) {
  const { t } = useTranslation()
  const [assets, setAssets] = useState<SeedAsset[]>([])
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const level = deckId ? { deckId } : { projectId }

  // Load, then poll while any extraction is still running
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const load = () => {
      listSeedAssets(level)
        .then(list => {
          if (cancelled) return
          setAssets(list)
          if (list.some(a => a.status === 'processing')) {
            timer = window.setTimeout(load, POLL_MS)
          }
        })
        .catch(() => {
          // Quiet failure: the list simply stays as-is
        })
    }
    load()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, deckId])

  const startPolling = () => {
    // A fresh upload is processing; re-run the load/poll effect cheaply
    listSeedAssets(level)
      .then(list => {
        setAssets(list)
        if (list.some(a => a.status === 'processing')) {
          window.setTimeout(startPolling, POLL_MS)
        }
      })
      .catch(() => undefined)
  }

  /** Uploads one file and starts watching its extraction, shared by the
   * file picker and drag-and-drop. */
  const uploadFile = async (file: File) => {
    setUploadError(null)
    try {
      const asset = await uploadSeedAsset(file, { projectId, deckId })
      setAssets(prev => [asset, ...prev])
      window.setTimeout(startPolling, POLL_MS)
    } catch {
      setUploadError(t('seed.uploadFailed'))
    }
  }

  // Upload every selected/dropped file, one after another
  const uploadFiles = async (files: File[]) => {
    for (const file of files) await uploadFile(file)
  }

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    await uploadFiles(files)
  }

  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    void uploadFiles(Array.from(e.dataTransfer.files ?? []))
  }

  const patch = (updated: SeedAsset) =>
    setAssets(prev => prev.map(a => (a.id === updated.id ? updated : a)))

  const toggle = (asset: SeedAsset) => {
    updateSeedAsset({ assetId: asset.id, enabled: !asset.enabled })
      .then(patch)
      .catch(() => {
        // Quiet failure: the toggle stays as saved
      })
  }

  const remove = (asset: SeedAsset) => {
    deleteSeedAsset(asset.id)
      .then(() => setAssets(prev => prev.filter(a => a.id !== asset.id)))
      .catch(() => {
        // Quiet failure: the row simply stays
      })
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        onChange={e => void onPick(e)}
        aria-label={t('seed.uploadLabel')}
        className="hidden"
      />
      <div
        onDragOver={e => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-2 rounded-md border border-dashed px-3 py-4 text-center ${
          dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-300'
        }`}
      >
        <button
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <UploadCloud className="h-4 w-4" aria-hidden />
          {t('seed.upload')}
        </button>
        <span className="text-xs text-slate-400">{t('seed.orDrop')}</span>
      </div>
      {uploadError && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {uploadError}
        </p>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {assets.map(asset => (
          <li
            key={asset.id}
            className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2"
          >
            {asset.type === 'image' && asset.imageUrl ? (
              <img
                src={asset.imageUrl}
                alt={asset.caption ?? asset.name}
                className="h-12 w-12 rounded object-cover"
              />
            ) : asset.type === 'image' ? (
              <ImageIcon className="h-5 w-5 text-slate-400" aria-hidden />
            ) : (
              <FileText className="h-5 w-5 text-slate-400" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {asset.name}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    asset.status === 'failed'
                      ? 'bg-red-50 text-red-700'
                      : asset.status === 'processing'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-emerald-50 text-emerald-700'
                  }`}
                >
                  {t(`seed.status.${asset.status}`)}
                </span>
              </div>
              {asset.text && (
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                  {asset.text}
                </p>
              )}
              {asset.type === 'image' && asset.status === 'ready' && (
                <div className="mt-1">
                  <CaptionField asset={asset} onSaved={patch} />
                </div>
              )}
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-1 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={asset.enabled}
                onChange={() => toggle(asset)}
                aria-label={t('seed.useIn', { name: asset.name })}
              />
              {t('seed.use')}
            </label>
            <button
              aria-label={t('seed.deleteAsset', { name: asset.name })}
              title={t('common.delete')}
              onClick={() => remove(asset)}
              className="shrink-0 rounded p-1 text-slate-400 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
        {assets.length === 0 && (
          <li className="text-sm text-slate-500">{t('seed.empty')}</li>
        )}
      </ul>
    </div>
  )
}
