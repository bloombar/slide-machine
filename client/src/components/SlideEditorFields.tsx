/**
 * Editable slide fields with debounced auto-save (EDIT-1): changes are
 * pushed through slide.editContent after a short pause in typing — no
 * Save button. A subtle status line reports Saving…/Saved; failures ask
 * the user to keep typing (the next change retries).
 */
import { useEffect, useRef, useState } from 'react'
import type { Slide } from '@slide-machine/shared'
import { dispatchAction } from '../api/actions'

interface Draft {
  title: string
  body: string
  bulletsText: string
  caption: string
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const toDraft = (slide: Slide): Draft => ({
  title: slide.title ?? '',
  body: slide.body ?? '',
  bulletsText: (slide.bullets ?? []).join('\n'),
  caption: slide.caption ?? '',
})

interface Props {
  slide: Slide
  onSaved: (slide: Slide) => void
  /** Debounce for auto-save; overridable in tests. */
  debounceMs?: number
}

export default function SlideEditorFields({
  slide,
  onSaved,
  debounceMs = 800,
}: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(slide))
  const [status, setStatus] = useState<SaveStatus>('idle')
  const savedRef = useRef<Draft>(toDraft(slide))

  useEffect(() => {
    const dirty = JSON.stringify(draft) !== JSON.stringify(savedRef.current)
    if (!dirty) return
    const timer = setTimeout(async () => {
      setStatus('saving')
      try {
        const updated = await dispatchAction<Slide>('slide.editContent', {
          slideId: slide.id,
          title: draft.title,
          body: draft.body,
          bullets: draft.bulletsText.split('\n').filter(Boolean),
          caption: draft.caption,
        })
        savedRef.current = draft
        setStatus('saved')
        onSaved(updated)
      } catch {
        setStatus('error')
      }
    }, debounceMs)
    return () => clearTimeout(timer)
  }, [draft, debounceMs, slide.id, onSaved])

  const field = (value: string, set: (v: string) => void, label: string) => ({
    value,
    'aria-label': label,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      set(e.target.value),
    className: 'rounded-md border border-slate-300 px-3 py-2 text-sm',
  })

  return (
    <div className="flex flex-col gap-2">
      <input
        {...field(
          draft.title,
          v => setDraft(d => ({ ...d, title: v })),
          'Slide title',
        )}
      />
      <textarea
        rows={3}
        {...field(
          draft.body,
          v => setDraft(d => ({ ...d, body: v })),
          'Slide body',
        )}
      />
      <textarea
        rows={3}
        placeholder="Bullets — one per line"
        {...field(
          draft.bulletsText,
          v => setDraft(d => ({ ...d, bulletsText: v })),
          'Slide bullets',
        )}
      />
      <input
        {...field(
          draft.caption,
          v => setDraft(d => ({ ...d, caption: v })),
          'Slide caption',
        )}
      />
      <p aria-live="polite" className="h-4 text-xs text-slate-400">
        {status === 'saving' && 'Saving…'}
        {status === 'saved' && 'Saved'}
        {status === 'error' && 'Save failed — keep typing to retry'}
      </p>
    </div>
  )
}
