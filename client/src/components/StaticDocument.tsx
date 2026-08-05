/**
 * Renders a static document — About, Privacy, Terms — as a page: heading,
 * one-line summary, the date it last changed where it has one, and the
 * Markdown body.
 *
 * The body is our own content, not user input, but it still goes through
 * react-markdown, which never injects raw HTML. Typography is set per element
 * here rather than by a prose plugin, so these pages need no dependency the
 * rest of the app does not already have.
 *
 * Links inside the documents point at each other (`/privacy`, `/feedback`),
 * so an in-app path becomes a router link and only genuinely external ones
 * leave the page.
 */
import Markdown from 'react-markdown'
import { Link } from 'react-router'
import type { StaticDocument as Doc } from '../content/document'

/** A path inside the app, as opposed to a link off it. */
const isInternal = (href: string | undefined): href is string =>
  Boolean(href?.startsWith('/'))

const LINK_CLASS =
  'text-indigo-700 underline underline-offset-2 hover:text-indigo-900'

export default function StaticDocument({ doc }: { doc: Doc }) {
  return (
    // The app's standard content column (the same one AppShell's main and
    // ProfilePage use), so these pages start where every other page does.
    // Inside it the prose keeps a readable measure rather than running the
    // full width — long-form text set to 1024px is hard to track back — so
    // only the right edge stops short of the column.
    <article className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <header className="max-w-3xl border-b border-slate-200 pb-4">
        <h1 className="text-3xl font-bold tracking-tight">{doc.title}</h1>
        <p className="mt-2 text-slate-600">{doc.summary}</p>
        {doc.updated && (
          <p className="mt-2 text-xs text-slate-500">
            {/* Not a translated string: these documents are English-only
                (see content/document.ts), and a date with an English label
                beside French prose would be worse than either. */}
            Last updated: {doc.updated}
          </p>
        )}
      </header>

      <div className="mt-6 max-w-3xl text-slate-700">
        <Markdown
          components={{
            h2: ({ children }) => (
              <h2 className="mt-8 mb-2 text-xl font-semibold text-slate-900">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="mt-6 mb-2 text-base font-semibold text-slate-900">
                {children}
              </h3>
            ),
            p: ({ children }) => <p className="my-3 leading-7">{children}</p>,
            ul: ({ children }) => (
              <ul className="my-3 list-disc space-y-2 ps-6 leading-7">
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol className="my-3 list-decimal space-y-2 ps-6 leading-7">
                {children}
              </ol>
            ),
            strong: ({ children }) => (
              <strong className="font-semibold text-slate-900">
                {children}
              </strong>
            ),
            // Used for the "this is a draft" notice at the top of the legal
            // documents, which has to read as an aside rather than as terms.
            blockquote: ({ children }) => (
              <blockquote className="my-4 border-s-4 border-amber-300 bg-amber-50 py-1 ps-4 text-sm text-amber-900">
                {children}
              </blockquote>
            ),
            a: ({ href, children }) =>
              isInternal(href) ? (
                <Link to={href} className={LINK_CLASS}>
                  {children}
                </Link>
              ) : (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className={LINK_CLASS}
                >
                  {children}
                </a>
              ),
          }}
        >
          {doc.body}
        </Markdown>
      </div>
    </article>
  )
}
