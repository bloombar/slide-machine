/**
 * A program listing (TMPL-9 `code` / EDIT-7).
 *
 * The highlighter and its sixteen grammars are a third of a megabyte, and most
 * lectures contain no code at all. So they load on demand, with the first
 * slide that shows a listing, rather than with the app.
 *
 * The fallback is the listing itself, set in the same monospaced face at the
 * same size — not a spinner and not a blank. Nothing is missing while the
 * grammars are in flight; the words are all there, and the colours arrive.
 * That also makes the split safe: if the chunk never loads, the slide is still
 * readable.
 */
import { Suspense, lazy } from 'react'

export { HIGHLIGHTED_LANGUAGES, resolveLanguage } from './code-languages'

const Highlighted = lazy(() => import('./CodeHighlighted'))

interface Props {
  source: string
  /** The language the slot declares. An unknown one shows plainly. */
  language?: string
}

/** The listing with no colours — the shape of the box, exactly. */
const Plain = ({ source, language }: Props) => (
  <pre
    className="hljs overflow-auto rounded-[0.8cqi] p-[1.5cqi] text-start font-mono text-[2cqi] leading-[1.5] whitespace-pre"
    data-language={language ?? undefined}
  >
    <code>{source}</code>
  </pre>
)

export default function SlideCode(props: Props) {
  return (
    <Suspense fallback={<Plain {...props} />}>
      <Highlighted {...props} />
    </Suspense>
  )
}
