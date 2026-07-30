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
 * When the slide's original lecture audio is still retained (GEN-4), it can also
 * be re-transcribed here: "Regenerate from spoken audio" runs the speech engine
 * over that recording and drops the result into the field. Nothing is written
 * until Save, so a regeneration is as discardable as any other edit.
 *
 * The heading row carries two more tools for the text in the field: "Refine",
 * which rewrites it through the same narration pass (and strength) as the kebab
 * "Refine this slide", and a play/pause control that speaks it aloud. Both work
 * on the FIELD, so a narration can be reworked and heard before it is saved;
 * playback runs on the shared TTS controller that "Speak this slide" and deck
 * playback use, so starting a preview silences those instead of talking over
 * them.
 *
 * Cancel, Escape, and the backdrop dismiss without saving — but only after
 * confirmation once the field differs from the stored transcript, so neither a
 * long rewrite nor a regeneration is lost to a stray keypress.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Pause, Play } from 'lucide-react'
import { hasVisibleDrawings, type Slide } from '@slide-machine/shared'
import {
  editSlideTranscript,
  refineSlideTranscript,
  regenerateSlideTranscript,
} from '../api/slides'
import type { TtsPlayback } from '../tts/playback'
import ConfirmDialog from './ConfirmDialog'
import Modal from './Modal'

interface Props {
  slide: Slide
  /** 1-based slide number, for the dialog heading. */
  number: number
  /** Offer "Regenerate from spoken audio" — only when recorded audio of this
   * slide is still available and the server can transcribe it. */
  canRegenerate?: boolean
  /** Offer "Refine" — off when the lecture's Refine settings have the spoken
   * narration pass turned off. */
  canRefine?: boolean
  /** The app's TTS controller, for previewing the text aloud. Omitted when TTS
   * is unavailable, which hides the play control. */
  tts?: TtsPlayback
  /** Receives the refreshed slide (new transcript + re-anchored marks). */
  onSaved: (slide: Slide) => void
  onClose: () => void
}

export default function TranscriptEditorModal({
  slide,
  number,
  canRegenerate,
  canRefine,
  tts,
  onSaved,
  onClose,
}: Props) {
  const { t } = useTranslation()
  const original = slide.sourceTranscript ?? ''
  const [text, setText] = useState(original)
  const [saving, setSaving] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [refining, setRefining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const marked = hasVisibleDrawings(slide.drawings)
  const busy = saving || regenerating || refining
  /** The field is locked while text is being produced for it. */
  const filling = regenerating || refining
  /** Unsaved work: whatever put it there, an edit or a regeneration. */
  const dirty = text !== original

  // The preview speaks THIS text, so any change to it invalidates what is being
  // spoken — stop rather than read stale words aloud. Read through a ref: the
  // controller is a fresh object each render, and only the text should retrigger.
  const ttsRef = useRef(tts)
  // Declared first so it refreshes before the effects below read it.
  useEffect(() => {
    ttsRef.current = tts
  })
  const spokenRef = useRef(text)
  useEffect(() => {
    if (spokenRef.current === text) return // first render, not an edit
    spokenRef.current = text
    const controller = ttsRef.current
    if (controller?.scope === 'text') controller.stop()
  }, [text])
  // Leaving the editor stops its preview; anything else playing is left alone.
  useEffect(
    () => () => {
      const controller = ttsRef.current
      if (controller?.scope === 'text') controller.stop()
    },
    [],
  )

  /** Whether the preview is the thing currently speaking. */
  const previewing = tts?.scope === 'text' && tts.status !== 'idle'
  const previewPlaying = previewing && tts?.status === 'playing'

  /** Play the field's text, or pause/resume a preview already running. */
  const togglePreview = () => {
    if (!tts) return
    if (previewing) tts.pauseResume()
    else tts.speakText(slide, text)
  }

  /** Dismissal path for Cancel, Escape, and the backdrop: unsaved changes are
   * confirmed away rather than dropped silently. */
  const requestClose = () => {
    if (busy) return
    if (dirty) setConfirmingDiscard(true)
    else onClose()
  }

  /**
   * Re-transcribes the slide's recorded audio into the field, leaving the save
   * to the user. The text it replaces is only in the field (unsaved), so a
   * regeneration discards nothing that was stored.
   */
  const regenerate = async () => {
    if (busy) return
    setRegenerating(true)
    setError(null)
    try {
      const { transcript } = await regenerateSlideTranscript(slide.id)
      setText(transcript)
    } catch {
      setError(t('transcript.errors.regenerate'))
    } finally {
      setRegenerating(false)
    }
  }

  /**
   * Refines the narration through the same pass (and strength) as "Refine this
   * slide", dropping the result in the field. Like a regeneration, it is only a
   * proposal until the user saves.
   */
  const refine = async () => {
    if (busy) return
    setRefining(true)
    setError(null)
    try {
      const { transcript } = await refineSlideTranscript(slide.deckId, slide.id)
      setText(transcript)
    } catch {
      setError(t('transcript.errors.refine'))
    } finally {
      setRefining(false)
    }
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!dirty) {
      onClose()
      return
    }
    setSaving(true)
    setError(null)
    try {
      onSaved(await editSlideTranscript(slide.id, text))
      onClose()
    } catch {
      setError(t('transcript.errors.save'))
      setSaving(false)
    }
  }

  return (
    <Modal
      ariaLabelledBy="edit-transcript-title"
      size="lg"
      onClose={requestClose}
      initialFocusRef={textRef}
      // While the discard prompt is up it owns Escape; two capture-phase
      // handlers would otherwise fight over the same keypress.
      closeOnEscape={!confirmingDiscard}
    >
      <form onSubmit={onSubmit}>
        {/* Heading on the left, Refine between, and the preview control on the
            right — flush with the right edge of the field whose text it speaks. */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 id="edit-transcript-title" className="text-lg font-bold">
              {t('transcript.title', { number })}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {t('transcript.intro')}
            </p>
          </div>
          {canRefine && (
            <button
              type="button"
              onClick={() => void refine()}
              disabled={busy}
              className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {refining ? t('refine.running') : t('transcript.refineWithAi')}
            </button>
          )}
          {tts && (
            <button
              type="button"
              onClick={togglePreview}
              // Nothing to speak, and speaking while new text is being produced
              // would read words that are about to be replaced.
              disabled={!text.trim() || filling}
              aria-label={
                previewPlaying
                  ? t('transcript.pausePreview')
                  : t('transcript.playPreview')
              }
              aria-pressed={previewing}
              className="shrink-0 rounded-full border border-slate-300 p-2 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {previewPlaying ? (
                <Pause className="h-4 w-4" aria-hidden />
              ) : (
                <Play className="h-4 w-4" aria-hidden />
              )}
            </button>
          )}
        </div>

        <label htmlFor="slide-transcript" className="sr-only">
          {t('transcript.label')}
        </label>
        <textarea
          id="slide-transcript"
          ref={textRef}
          value={text}
          onChange={e => setText(e.target.value)}
          rows={12}
          disabled={filling}
          placeholder={t('transcript.placeholder')}
          className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-relaxed disabled:bg-slate-100 disabled:text-slate-500"
        />

        {marked && (
          <p className="mt-2 text-sm text-slate-500">
            {t('transcript.marked')}
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}

        {/* The regenerate link sits on the left of the button row, flush with
            the left edge of the field it rewrites. */}
        <div className="mt-6 flex items-center justify-between gap-4">
          <div className="min-w-0 text-sm">
            {canRegenerate &&
              (regenerating ? (
                <span
                  role="status"
                  className="flex items-center gap-2 text-slate-500"
                >
                  <span
                    aria-hidden
                    className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600"
                  />
                  {t('transcript.regenerating')}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void regenerate()}
                  disabled={busy}
                  className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-500 disabled:opacity-50"
                >
                  {t('transcript.regenerate')}
                </button>
              ))}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={requestClose}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? t('common.saving') : t('transcript.save')}
            </button>
          </div>
        </div>
      </form>

      {confirmingDiscard && (
        <ConfirmDialog
          title={t('transcript.discard.title')}
          message={t('transcript.discard.message')}
          confirmLabel={t('transcript.discard.action')}
          onConfirm={onClose}
          onCancel={() => setConfirmingDiscard(false)}
        />
      )}
    </Modal>
  )
}
