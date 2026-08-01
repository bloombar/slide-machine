/**
 * Markdown ↔ HTML conversion for slide text (SHARE-2 translated viewing).
 *
 * Slide text is stored as restricted Markdown, but Google Cloud Translation
 * only preserves inline formatting when it is given HTML — its `format: 'html'`
 * mode carries tags along with the words as the target language reorders them,
 * which is what keeps **bold**, links, and `code` intact across a translation.
 * So content is converted to HTML on the way out and back to Markdown on the
 * way in, leaving Markdown as the one stored format everything else reads.
 *
 * The pipelines are unified/remark/rehype — the same ecosystem the viewer's
 * react-markdown is built on, so what converts here parses the same way as what
 * renders there. The element whitelist is enforced by rehype-sanitize in BOTH
 * directions, so a translated response can never introduce markup the viewer
 * would not have rendered anyway.
 */
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkBreaks from 'remark-breaks'
import remarkRehype from 'remark-rehype'
import remarkStringify from 'remark-stringify'
import rehypeParse from 'rehype-parse'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import rehypeRemark from 'rehype-remark'
import type { Element, Root } from 'hast'
import { visit } from 'unist-util-visit'

/**
 * Exactly the elements the viewer renders (see client SlideMarkdown): inline
 * emphasis, links and code everywhere, plus lists and paragraphs in block
 * slots. Headings and raw HTML are deliberately absent — block structure is
 * the template layout's job (TMPL-6), and no attribute other than a link's
 * href survives, so no class, style, or event handler can ride in.
 */
export const SLIDE_SCHEMA = {
  ...defaultSchema,
  tagNames: ['p', 'br', 'strong', 'em', 'del', 'code', 'a', 'ul', 'ol', 'li'],
  attributes: { a: ['href'] },
  protocols: { href: ['http', 'https', 'mailto'] },
}

/** Markdown → sanitized HTML. */
const toHtml = unified()
  .use(remarkParse)
  // The viewer treats a single newline as a line break, so the HTML must too
  .use(remarkBreaks)
  .use(remarkRehype)
  .use(rehypeSanitize, SLIDE_SCHEMA)
  .use(rehypeStringify)
  .freeze()

/**
 * HTML → Markdown. `<br>` becomes a bare newline rather than mdast's `break`
 * node: remark-stringify would render a break as a trailing backslash, and the
 * source it has to match used a plain newline (remarkBreaks turns those into
 * the `<br>`s this reverses).
 */
const toMarkdown = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeSanitize, SLIDE_SCHEMA)
  .use(rehypeRemark, {
    handlers: { br: () => ({ type: 'text' as const, value: '\n' }) },
  })
  .use(remarkStringify, { bullet: '-', emphasis: '*', strong: '*' })
  .freeze()

/** Unwraps the single paragraph remark wraps inline content in. */
const unwrapParagraph = (html: string): string => {
  const inner = /^<p>([\s\S]*)<\/p>$/.exec(html.trim())?.[1]
  // A nested <p> means this was several paragraphs, not one inline run —
  // stripping the outer tags would then splice two blocks together.
  return inner !== undefined && !inner.includes('<p>') ? inner : html
}

/**
 * Converts one slide field's Markdown to HTML for translation. Inline fields
 * (title, caption, a single bullet) come back without the wrapping paragraph,
 * matching how the viewer renders them.
 */
export const markdownToHtml = (
  markdown: string,
  options: { inline?: boolean } = {},
): string => {
  if (!markdown.trim()) return ''
  const html = String(toHtml.processSync(markdown)).trim()
  return options.inline ? unwrapParagraph(html) : html
}

/** Converts translated HTML back to the Markdown the slide is stored as. */
export const htmlToMarkdown = (html: string): string => {
  if (!html.trim()) return ''
  return String(toMarkdown.processSync(html)).trim()
}

/** Parses/serializes HTML fragments without converting them, for href repair. */
const hastOnly = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeStringify)
  .freeze()

/** Every anchor element in the fragment, in document order. */
const anchorsOf = (tree: Root): Element[] => {
  const anchors: Element[] = []
  visit(tree, 'element', (node: Element) => {
    if (node.tagName === 'a') anchors.push(node)
  })
  return anchors
}

/**
 * Puts the source's link targets back on the translated HTML.
 *
 * A translator is asked to translate prose, not URLs, but nothing stops it
 * from rewriting one — and a silently mistranslated link is worse than an
 * untranslated word. Anchors are matched by document order, which holds
 * because the whole point of `format: 'html'` is that tags travel with their
 * text. If the counts disagree the translation restructured the markup beyond
 * what order-matching can align, so the translated hrefs are left alone rather
 * than paired up wrongly.
 */
export const restoreLinkHrefs = (
  sourceHtml: string,
  translatedHtml: string,
): string => {
  const sources = anchorsOf(hastOnly.parse(sourceHtml)).map(
    a => a.properties?.href,
  )
  if (!sources.length) return translatedHtml
  const tree = hastOnly.parse(translatedHtml)
  const anchors = anchorsOf(tree)
  if (anchors.length !== sources.length) return translatedHtml
  anchors.forEach((anchor, i) => {
    anchor.properties = { ...anchor.properties, href: sources[i] }
  })
  return String(hastOnly.stringify(tree))
}
