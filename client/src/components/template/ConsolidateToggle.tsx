/**
 * The one control that decides whether an import merges near-identical
 * slides into a single layout, or keeps each slide's design as its own
 * (TMPL-8).
 *
 * One component rather than one per import route, because there are two
 * routes — a Slides link and an uploaded `.pptx` — and they used to disagree:
 * the link route offered the choice while the upload route silently merged,
 * having never sent the field at all. Two copies of a checkbox is how that
 * happens, so there is one.
 *
 * The default is not restated here. It is derived from
 * `KEEP_EVERY_SLIDE_BY_DEFAULT`, the same constant the action schemas read,
 * so the control and the server cannot drift apart the way they had.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KEEP_EVERY_SLIDE_BY_DEFAULT } from '@slide-machine/shared'

/**
 * The control's own state, and what the server should be told.
 *
 * `tidy` is the inverse of what the action takes: the box asks to MERGE, the
 * action asks whether to KEEP. Stated once, here, so no caller has to
 * remember which way round it is.
 */
export const useConsolidateChoice = () => {
  const [tidy, setTidy] = useState(!KEEP_EVERY_SLIDE_BY_DEFAULT)
  return { tidy, setTidy, keepEverySlide: !tidy }
}

export default function ConsolidateToggle({
  tidy,
  onChange,
  /**
   * Say that this concerns presentations.
   *
   * The link route knows whether the thing being imported has slides and
   * hides the control when it does not — a control that cannot do anything is
   * worse than one that is absent. The upload route cannot know until after
   * the file is chosen, since choosing it starts the import. So rather than
   * pretend to a certainty it lacks, it shows the control and says what it
   * applies to. The two treatments differ because what the two routes KNOW
   * differs; this is not an inconsistency to tidy away.
   */
  scoped = false,
}: {
  tidy: boolean
  onChange: (tidy: boolean) => void
  scoped?: boolean
}) {
  const { t } = useTranslation()
  return (
    <label className="mt-2 flex items-start gap-2 text-sm text-slate-600">
      <input
        type="checkbox"
        checked={tidy}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span>
        {/*
          The two routes get DIFFERENT labels, not one label twice.

          Both import panels can be on screen together, and a control's
          accessible name is what a screen reader announces — two checkboxes
          reading "Combine near-identical slides into one layout" on one page
          leave a listener no way to tell which import each governs. The
          ambiguity is the defect; that a strict locator also could not tell
          them apart is the same fact seen from the outside.

          So each names what it acts on rather than repeating the action —
          and they differ from the FIRST word rather than sharing an opening
          and diverging at the end. A listener should not have to hear eight
          identical words before the two are told apart.
        */}
        {t(scoped ? 'template.import.tidyFile' : 'template.import.tidy')}
        <span className="block text-xs text-slate-500">
          {t(
            scoped
              ? 'template.import.tidyHintFile'
              : 'template.import.tidyHint',
          )}
        </span>
      </span>
    </label>
  )
}
