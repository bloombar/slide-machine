/**
 * The highlighting half of a code slot (TMPL-9 `code` / EDIT-7).
 *
 * Split from `Code.tsx` and loaded on demand: the grammars and their theme are
 * a third of a megabyte, and a lecture with no program listings in it should
 * not carry them. `Code.tsx` shows the listing plainly until this arrives, so
 * nothing is missing in the meantime — only the colours.
 *
 * Two properties matter more than the colours. **Indentation is preserved
 * exactly** — a Python listing whose leading spaces were normalized is a
 * different program — and **nothing reflows it**: no wrapping, no smart
 * quotes, no spell correction. What the author typed is what runs.
 *
 * ## Why a curated language set
 *
 * highlight.js ships around two hundred grammars and the whole library is
 * megabytes. A lecture tool needs the languages lectures are actually given
 * in, so the core is imported and a short list registered against it. A
 * language outside the list is not an error: the listing is shown
 * unhighlighted, which is exactly as readable and merely less colourful.
 *
 * Highlighting happens here rather than at generation time because it is a
 * function of the source and the language, and both can change under an edit.
 */
import { useMemo } from 'react'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import html from 'highlight.js/lib/languages/xml'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import r from 'highlight.js/lib/languages/r'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import 'highlight.js/styles/github-dark.css'
import { resolveLanguage } from './code-languages'

/** The grammars behind `HIGHLIGHTED_LANGUAGES`. Registered once; the module is
 * a singleton, so re-registering on every render would be wasted work. */
const LANGUAGES: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  go,
  html,
  java,
  javascript,
  json,
  python,
  r,
  ruby,
  rust,
  sql,
  typescript,
}

for (const [name, language] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, language)
}

interface Props {
  source: string
  /** The language the slot declares. An unknown one shows plainly. */
  language?: string
  /** What the block sits on, from the template's palette (`codeSurface`). */
  surface?: string
}

/**
 * The type size a listing is set at, so its longest line fits the box.
 *
 * A listing must never be reflowed — its line breaks are the author's, and
 * wrapping one changes the program. But a slide that clips its code at both
 * edges shows nobody anything, so what gives instead is the type size, down to
 * a floor below which it would not be readable anyway.
 *
 * Measured in `cqi`, a percent of the slide's width, so a monospaced line of
 * N characters occupies about `N × size × 0.6` of it.
 */
const CHAR_WIDTH = 0.6
const MAX_SIZE = 2
const MIN_SIZE = 0.9
/** The share of the box a listing may fill before it has to shrink. */
const USABLE = 92

const fitSize = (source: string): number => {
  const longest = source
    .split('\n')
    .reduce((n, line) => Math.max(n, line.length), 0)
  if (!longest) return MAX_SIZE
  const fits = USABLE / (longest * CHAR_WIDTH)
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, fits))
}

export default function SlideCode({ source, language, surface }: Props) {
  const resolved = resolveLanguage(language)
  const html = useMemo(() => {
    if (!resolved) return undefined
    try {
      return hljs.highlight(source, { language: resolved }).value
    } catch {
      // A grammar that chokes on a fragment costs the listing its colours,
      // never the slide.
      return undefined
    }
  }, [source, resolved])

  return (
    <pre
      // `whitespace-pre` and no wrapping: the author's indentation and line
      // breaks are the content, not a rendering choice.
      //
      // Scrolls rather than hides what overruns, which is what the unhighlighted
      // fallback has always done. The type size below is chosen to keep the
      // longest line on the slide, but it is a calculation against an assumed
      // box — when it is wrong, a line the reader can reach beats one silently
      // cut off mid-token.
      className="hljs overflow-auto rounded-[0.8cqi] p-[1.5cqi] text-start font-mono leading-[1.5] whitespace-pre w-max min-w-full box-border"
      style={{
        fontSize: `${fitSize(source)}cqi`,
        ...(surface ? { background: surface } : {}),
      }}
      data-language={resolved ?? language ?? undefined}
    >
      {html === undefined ? (
        <code>{source}</code>
      ) : (
        <code dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </pre>
  )
}
