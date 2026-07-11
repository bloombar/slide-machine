/**
 * Restricted Markdown rendering for slide text (inline emphasis, links,
 * code — plus lists in block slots). Block structure like headings stays
 * the template layout's job (TMPL-6), so heading syntax is not enabled.
 * react-markdown never injects raw HTML, keeping shared decks safe.
 * Elements are styled to inherit the slide's template typography.
 */
import Markdown from 'react-markdown'

const INLINE_ELEMENTS = ['p', 'strong', 'em', 'del', 'code', 'a']
const BLOCK_ELEMENTS = [...INLINE_ELEMENTS, 'ul', 'ol', 'li']

interface Props {
  text: string
  /** Inline slots (title, caption, bullet) unwrap paragraphs and forbid lists. */
  inline?: boolean
  /** false renders links as inert styled text (owner edit mode: clicks edit). */
  links?: boolean
}

export default function SlideMarkdown({
  text,
  inline = false,
  links = true,
}: Props) {
  return (
    <Markdown
      allowedElements={inline ? INLINE_ELEMENTS : BLOCK_ELEMENTS}
      unwrapDisallowed
      components={{
        // Inline slots live inside existing h1/p elements — no nested <p>
        ...(inline
          ? {
              p: ({ children }: { children?: React.ReactNode }) => (
                <>{children}</>
              ),
            }
          : {}),
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
            <span className="underline decoration-current/50 underline-offset-4">
              {children}
            </span>
          ),
        code: ({ children }) => (
          <code className="rounded bg-black/10 px-1 font-mono text-[0.9em]">
            {children}
          </code>
        ),
        ul: ({ children }) => (
          <ul className="flex list-disc flex-col gap-1 pl-6 text-left">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="flex list-decimal flex-col gap-1 pl-6 text-left">
            {children}
          </ol>
        ),
      }}
    >
      {text}
    </Markdown>
  )
}
