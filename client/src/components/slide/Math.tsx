/**
 * A mathematical expression (TMPL-9 `math` / EDIT-7).
 *
 * KaTeX and its nineteen font files are a large thing to make every lecture
 * carry for the sake of the ones with equations in them, so they load on
 * demand, with the first slide that shows a formula.
 *
 * The fallback is the LaTeX source in a monospaced face. It is not what the
 * author meant an audience to read, but it is honest and it is brief — and it
 * is what a formula degrades to everywhere else in this system, so nothing new
 * has to be learned to recognize it.
 */
import { Suspense, lazy } from 'react'

const Typeset = lazy(() => import('./MathTypeset'))

interface Props {
  tex: string
  /** Display style — centred on a line of its own, with full-size operators.
   * Inline keeps the expression in the run of text around it. */
  display?: boolean
}

export default function SlideMath(props: Props) {
  return (
    <Suspense
      fallback={<code className="font-mono text-[2cqi]">{props.tex}</code>}
    >
      <Typeset {...props} />
    </Suspense>
  )
}
