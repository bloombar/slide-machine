/**
 * Restricted Markdown rendering for slide text (inline emphasis, links,
 * code — plus lists in block slots).
 *
 * Spacing between paragraphs and points is in `em`, not `cqi`: it belongs to
 * the type, not to the slide. In `cqi` it was a fraction of the slide's WIDTH
 * and so held still while the type shrank to fit its box — on a slide of
 * seven points the gaps came to dominate, and the text could be taken down to
 * three pixels with the last line still hidden below the fold. Block structure like headings stays
 * the template layout's job (TMPL-6), so heading syntax is not enabled.
 * react-markdown never injects raw HTML, keeping shared decks safe.
 * Elements are styled to inherit the slide's template typography.
 */
import Markdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import { useTranslation } from 'react-i18next'

const INLINE_ELEMENTS = ['p', 'br', 'strong', 'em', 'del', 'code', 'a']
const BLOCK_ELEMENTS = [...INLINE_ELEMENTS, 'ul', 'ol', 'li']

interface Props {
  text: string
  /** Inline slots (title, caption, bullet) unwrap paragraphs and forbid lists. */
  inline?: boolean
  /** false is edit mode: the words around the link open the editor, while
   * the link itself is still followed on a plain click. */
  links?: boolean
}

export default function SlideMarkdown({
  text,
  inline = false,
  links = true,
}: Props) {
  const { t } = useTranslation()
  return (
    <Markdown
      remarkPlugins={[remarkBreaks]}
      allowedElements={inline ? INLINE_ELEMENTS : BLOCK_ELEMENTS}
      unwrapDisallowed
      components={{
        // Inline slots live inside existing h1/p elements — no nested <p>
        p: inline
          ? ({ children }: { children?: React.ReactNode }) => <>{children}</>
          : ({ children }: { children?: React.ReactNode }) => (
              <p className="mb-[0.8em] last:mb-0">{children}</p>
            ),
        a: ({ href, children }) => (
          /*
           * A link is a link, in edit mode as much as in front of an
           * audience: a plain click on the words opens the page in a new tab.
           *
           * In edit mode the box around it is a click-to-edit target, so the
           * click stops at the anchor rather than bubbling on to open the
           * editor as well. Clicking anywhere else in the box still edits it,
           * which is how the reader reaches the link's own text. The same
           * goes for Enter on a focused link, which follows it instead of
           * putting the box into edit mode.
           */
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            // Where the link goes, and — while the box is editable, where a
            // click could as easily have meant "edit this" — that clicking
            // will go there.
            title={links ? undefined : `${href}\n${t('slide.link.open')}`}
            onClick={links ? undefined : e => e.stopPropagation()}
            onKeyDown={
              links
                ? undefined
                : e => {
                    if (e.key === 'Enter') e.stopPropagation()
                  }
            }
            className="text-[color:var(--slide-link,inherit)] underline decoration-current/50 underline-offset-4"
          >
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="rounded bg-black/10 px-1 font-mono text-[0.9em]">
            {children}
          </code>
        ),
        ul: ({ children }) => (
          <ul className="flex list-disc flex-col gap-[0.2em] pl-[1.2em] text-left">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          /*
           * Numbers, then letters, then roman numerals as the list goes
           * deeper — the convention every document editor uses, and what the
           * slide this was imported from shows: "1." with "a. b. c." beneath
           * it. Markdown has one ordered list and no way to say which marker
           * it wants, so the depth decides, which is how the original decided
           * too.
           */
          <ol className="flex list-decimal flex-col gap-[0.2em] pl-[1.2em] text-left [&_ol]:list-[lower-alpha] [&_ol_ol]:list-[lower-roman]">
            {children}
          </ol>
        ),
      }}
    >
      {text}
    </Markdown>
  )
}
