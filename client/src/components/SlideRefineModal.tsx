/**
 * "Refine this slide with AI" (GEN-4), opened from the slide kebab. The
 * lecture-wide Refine tab's passes, scoped to one slide and chosen per run:
 * identify who spoke, refine the slide's text / layout / imagery, refine its
 * spoken transcript — all at one strength.
 *
 * The choices are for THIS run only: unlike the lecture tab (whose checkboxes
 * are the lecture's saved settings), nothing here is persisted, so refining one
 * slide differently never changes what the lecture does. The controls
 * themselves are the shared ones both surfaces use (components/refine).
 *
 * Refining rewrites the slide, so a slide carrying whiteboard marks says so
 * before the user commits — the same warning the transcript editor gives.
 */
import { useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type {
  SlideRefineOptions,
  SlideRefineParts,
} from '@slide-machine/shared'
import Modal from './Modal'
import {
  RefineLevelSlider,
  RefineOption,
  RefinePartsOptions,
} from './refine/RefineControls'

interface Props {
  /** 1-based slide number, for the dialog heading. */
  number: number
  /** True when the slide carries whiteboard marks that a rewrite may strand. */
  marked?: boolean
  /** Whether this slide has retained lecture audio, which is what speaker
   * identification reads; false disables that option. */
  hasAudio?: boolean
  /** Strength the slider starts at (the lecture's slides level). */
  defaultLevel: number
  /** Runs the refine; resolves when it finishes (the dialog closes itself). */
  onRefine: (options: SlideRefineOptions) => Promise<void>
  /** Leaves for the lecture's own Refine settings, for refining every slide;
   * without it the blurb just names them instead of linking. */
  onOpenLectureRefine?: () => void
  onClose: () => void
}

export default function SlideRefineModal({
  number,
  marked,
  hasAudio,
  defaultLevel,
  onRefine,
  onOpenLectureRefine,
  onClose,
}: Props) {
  const { t } = useTranslation()
  // Off by default, matching the lecture-wide tab. Speaker identification is
  // billed per minute of the whole recording at the same rate as capturing it
  // (docs/BILLING_COST_MODEL.md §7), so it is opted into rather than out of —
  // it is the one refinement pass that costs real money on a slide the user
  // may only have wanted reworded. With no audio it is unavailable entirely.
  const [identifySpeakers, setIdentifySpeakers] = useState(false)
  // Text, layout, and imagery are what "refine a slide" has always meant, so
  // they start on; the narration is a separate ask, so it starts off.
  const [parts, setParts] = useState<Required<SlideRefineParts>>({
    text: true,
    layout: true,
    imagery: true,
  })
  const [refineTranscript, setRefineTranscript] = useState(false)
  const [level, setLevel] = useState(defaultLevel)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const anyPart = Object.values(parts).some(Boolean)
  const anything = identifySpeakers || anyPart || refineTranscript

  const run = async () => {
    if (running || !anything) return
    setRunning(true)
    setError(null)
    try {
      await onRefine({ identifySpeakers, parts, refineTranscript, level })
      onClose()
    } catch {
      setError(t('refine.slide.failed'))
      setRunning(false)
    }
  }

  return (
    <Modal
      ariaLabelledBy="refine-slide-title"
      size="lg"
      onClose={running ? () => {} : onClose}
      initialFocusRef={closeRef}
    >
      <h3 id="refine-slide-title" className="text-lg font-bold">
        {t('refine.slide.title', { number })}
      </h3>
      <p className="mt-1 text-sm text-slate-500">
        {/* Trans, not t: the pointer to the lecture-wide options is a link
            when there is somewhere to send them, and plain text otherwise. */}
        <Trans
          i18nKey="refine.slide.intro"
          components={{
            lectureLink: onOpenLectureRefine ? (
              <button
                type="button"
                onClick={onOpenLectureRefine}
                disabled={running}
                className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-500 disabled:opacity-50"
              />
            ) : (
              <span />
            ),
          }}
        />
      </p>

      <fieldset disabled={running} className="mt-5 flex flex-col gap-5">
        <RefineOption
          label={t('refine.speakers.label')}
          description={
            <>
              {t('refine.speakers.descriptionSlide')}
              {!hasAudio && ` ${t('refine.speakers.noAudioSlide')}`}
            </>
          }
          checked={identifySpeakers}
          onChange={setIdentifySpeakers}
          disabled={!hasAudio}
        />

        <RefinePartsOptions value={parts} onChange={setParts} />

        <RefineOption
          label={t('refine.transcript.label')}
          description={t('refine.transcript.description')}
          checked={refineTranscript}
          onChange={setRefineTranscript}
        />

        <RefineLevelSlider
          value={level}
          onChange={setLevel}
          ariaLabel={t('refine.slide.levelLabel')}
        />
      </fieldset>

      {marked && (
        <p className="mt-4 text-sm text-slate-500">
          {t('refine.slide.marked')}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          disabled={running}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => void run()}
          disabled={running || !anything}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {running ? t('refine.running') : t('refine.action')}
        </button>
      </div>
    </Modal>
  )
}
