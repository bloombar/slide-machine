/**
 * Renders a static document (privacy policy, terms) to HTML on the server, so
 * the two legal pages carry their own text in the response body rather than
 * only inside the JS bundle.
 *
 * The app is client-rendered. Without this, `curl /privacy` returns an empty
 * `<div id="root">` and a script tag — and Google's OAuth privacy-policy
 * requirement asks for the policy "in the body of a dedicated privacy policy
 * web page" (docs/GOOGLE_PRODUCTION_MODE.md §3.3, AUTH-7). A link is not the
 * body.
 *
 * The words come from `@slide-machine/shared`, the same module the client
 * draws, so the two cannot disagree. Only the operator differs in where it is
 * read from: the client asks GET /api/config, the server reads its own
 * environment — which is why this stays a per-request render and not a
 * build-time one. Changing OPERATOR_* is a restart, not a rebuild.
 */
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import type { StaticDocument } from '@slide-machine/shared'

/**
 * What a document body is allowed to contain. Wider than SLIDE_SCHEMA in
 * markdown-html.ts — these are prose documents, so headings, blockquotes and
 * lists are the structure rather than a layout's job — but still a whitelist:
 * no raw HTML, no attribute but a link's href, no protocol but http(s)/mailto.
 */
export const DOCUMENT_SCHEMA = {
  ...defaultSchema,
  tagNames: [
    'p',
    'br',
    'strong',
    'em',
    'del',
    'code',
    'a',
    'ul',
    'ol',
    'li',
    'h2',
    'h3',
    'blockquote',
  ],
  attributes: { a: ['href'] },
  protocols: { href: ['http', 'https', 'mailto'] },
}

const toHtml = unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(rehypeSanitize, DOCUMENT_SCHEMA)
  .use(rehypeStringify)
  .freeze()

/** The five characters that could otherwise close a tag or open one. */
const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/**
 * A document as a self-contained HTML fragment: an `h1` carrying the title —
 * the page's only one, matching StaticDocument.tsx — the summary, the date
 * where the document has one, and the Markdown body.
 *
 * The title and summary are escaped rather than parsed: they are plain
 * strings in the document, not Markdown, and the client renders them as text.
 */
export const documentToHtml = (doc: StaticDocument): string => {
  const updated = doc.updated
    ? `<p>Last updated: ${escapeHtml(doc.updated)}</p>`
    : ''
  return [
    `<h1>${escapeHtml(doc.title)}</h1>`,
    `<p>${escapeHtml(doc.summary)}</p>`,
    updated,
    String(toHtml.processSync(doc.body)),
  ]
    .filter(Boolean)
    .join('\n')
}
