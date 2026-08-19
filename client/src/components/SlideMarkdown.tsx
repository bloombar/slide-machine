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

/**
 * Whether the reader is on a Mac, so the hint names the key they actually
 * have. Told from the platform string, which is all a browser offers and is
 * enough for the one question being asked.
 */
const onMac = (): boolean =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)

const INLINE_ELEMENTS = ['p', 'br', 'strong', 'em', 'del', 'code', 'a']
const BLOCK_ELEMENTS = [...INLINE_ELEMENTS, 'ul', 'ol', 'li']

interface Props {
  text: string
  /** Inline slots (title, caption, bullet) unwrap paragraphs and forbid lists. */
  inline?: boolean
  /** false is edit mode: a plain click belongs to the editor, and the link
   * is followed on Cmd/Ctrl-click. Still a real link either way. */
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
        a: ({ href, children }) =>
          links ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-current/50 underline-offset-4"
            >
              {children}
            </a>
          ) : (
            /*
             * Editable text: a plain click belongs to the editor, so the link
             * is followed on Cmd/Ctrl-click instead — the modifier a browser
             * already uses to open a link in a new tab, and what most editors
             * do for a link inside text you can edit.
             *
             * Still an anchor rather than a span, so it is announced as a
             * link, offers the address on hover, and can be opened from the
             * context menu. `onClick` swallows only the unmodified click,
             * which is the one the editor wants.
             */
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              // Both, and in this order: what the link points at, and how to
              // follow it. A link that swallows a plain click is otherwise a
              // link that looks broken — the behaviour has to say so itself,
              // since there is nowhere else on a slide to put an instruction.
              title={`${href}\n${t(
                onMac() ? 'slide.link.openMac' : 'slide.link.open',
              )}`}
              onClick={e => {
                if (!e.metaKey && !e.ctrlKey) e.preventDefault()
              }}
              className="underline decoration-current/50 underline-offset-4"
            >
              {children}
              {/*
               * The key to hold, on the link itself.
               *
               * A tooltip says it too, but only to someone who hovers and
               * waits — and the person who needs telling is the one who just
               * clicked and saw nothing happen. Small, muted, and only while
               * the slide is being edited: the audience never sees it.
               *
               * Hidden from screen readers, which announce the anchor as a
               * link already and would otherwise read the badge as part of
               * the link's text.
               */}
              <sup
                aria-hidden
                className="ms-[0.15em] align-super text-[0.6em] opacity-50"
              >
                {onMac() ? '⌘' : 'Ctrl'}
              </sup>
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
          <ol className="flex list-decimal flex-col gap-[0.2em] pl-[1.2em] text-left">
            {children}
          </ol>
        ),
      }}
    >
      {text}
    </Markdown>
  )
}
