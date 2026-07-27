/**
 * Editor for a slide's spoken transcript (EDIT-6), opened from the slide kebab.
 * The transcript is what text-to-speech reads during playback (PLAY-2), so this
 * is how a user fixes mis-transcribed speech or rewrites what the deck says.
 *
 * Whiteboard marks are timed by position within this text (EDIT-4/WB-2): the
 * server re-anchors them onto the saved transcript, matching each mark to the
 * phrase it was drawn over, so annotations are not lost by an edit. A slide
 * carrying marks says so, since heavy rewriting can still leave a mark with no
 * matching phrase to return to.
 *
 * Cancel and Escape dismiss without saving.
 */
import { useRef, useState, type FormEvent } from 'react'
import { hasVisibleDrawings, type Slide } from '@slide-machine/shared'
import { editSlideTranscript } from '../api/slides'
import Modal from './Modal'

interface Props {
  slide: Slide
  /** 1-based slide number, for the dialog heading. */
  number: number
  /** Receives the refreshed slide (new transcript + re-anchored marks). */
  onSaved: (slide: Slide) => void
  onClose: () => void
}

export default function TranscriptEditorModal({
  slide,
  number,
  onSaved,
  onClose,
}: Props) {
  const original = slide.sourceTranscript ?? ''
  const [text, setText] = useState(original)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const marked = hasVisibleDrawings(slide.drawings)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (text === original) {
      onClose()
      return
    }
    setSaving(true)
    setError(null)
    try {
      onSaved(await editSlideTranscript(slide.id, text))
      onClose()
    } catch {
      setError('Could not save the transcript — try again')
      setSaving(false)
    }
  }

  return (
    <Modal
      ariaLabelledBy="edit-transcript-title"
      size="lg"
      onClose={onClose}
      initialFocusRef={textRef}
    >
      <form onSubmit={onSubmit}>
        <h3 id="edit-transcript-title" className="text-lg font-bold">
          Spoken transcript — slide {number}
        </h3>
        <p className="mt-1 text-sm text-slate-500">
          This is what is read aloud when the deck is played.
        </p>

        <label htmlFor="slide-transcript" className="sr-only">
          Spoken transcript
        </label>
        <textarea
          id="slide-transcript"
          ref={textRef}
          value={text}
          onChange={e => setText(e.target.value)}
          rows={12}
          placeholder="Nothing has been recorded for this slide — playback narrates its content instead."
          className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-relaxed"
        />

        {marked && (
          <p className="mt-2 text-sm text-slate-500">
            This slide has whiteboard markings timed to the transcript. Saving
            re-matches each one to the words it was drawn over. A mark whose
            words are gone is hidden rather than moved — it is kept, not
            deleted, and returns if wording it matches comes back.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save transcript'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
