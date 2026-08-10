/**
 * The typesetting half of a math slot (TMPL-9 `math` / EDIT-7).
 *
 * Split from `Math.tsx` and loaded on demand: KaTeX and its font files are a
 * large thing for a lecture with no equations to carry. `Math.tsx` shows the
 * source until this arrives.
 *
 * An author writes LaTeX, which is the notation they already know, and the
 * audience sees the formula rather than its source. Those are two different
 * things and the slot is the only place they meet: the editor reveals the
 * source, the slide shows the result.
 *
 * KaTeX renders here rather than MathJax because it renders synchronously to
 * markup this component already controls — no script injected at display time,
 * nothing fetched from a third party while a lecture is on screen, and the
 * fonts ship in our own bundle (docs/TEMPLATES.md §5 makes the same promise
 * about typefaces).
 *
 * ## Invalid syntax
 *
 * A formula an author is midway through typing is not an error state. KaTeX is
 * asked not to throw, and what it cannot parse is shown as the source it
 * failed on, marked, with the reason — never a blank slot, and never a crash
 * that takes the slide with it.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import katex from 'katex'
import 'katex/dist/katex.min.css'

interface Props {
  tex: string
  /** Display style — centred on a line of its own, with full-size operators.
   * Inline keeps the expression in the run of text around it. */
  display?: boolean
}

export default function SlideMath({ tex, display = true }: Props) {
  const { t } = useTranslation()
  const rendered = useMemo(() => {
    try {
      return {
        html: katex.renderToString(tex, {
          displayMode: display,
          // Never throw: a half-written formula must not take the slide down.
          throwOnError: false,
          // `\\html…` and friends can emit markup; a shared deck is not a
          // place to let one in.
          trust: false,
          strict: false,
          output: 'htmlAndMathml',
        }),
        error: undefined as string | undefined,
      }
    } catch (error) {
      return {
        html: undefined,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }, [tex, display])

  if (rendered.html === undefined) {
    return (
      <span role="alert" className="text-[2cqi] text-red-500">
        <code className="font-mono">{tex}</code>
        <span className="ms-[1cqi] opacity-80">
          {t('slide.math.invalid', { reason: rendered.error })}
        </span>
      </span>
    )
  }

  return (
    <span
      // KaTeX's own markup, produced from the author's source rather than
      // supplied by anyone: `trust: false` above is what keeps it that way.
      dangerouslySetInnerHTML={{ __html: rendered.html }}
    />
  )
}
