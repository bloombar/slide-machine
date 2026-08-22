/**
 * Resolves the links and image paths in a lecture source to absolute URLs.
 *
 * The sources are written to be published as a website, so their paths are
 * relative to the *page* a lecture is served at — `/…/slides/<name>/` — not
 * to the markdown file's own directory. A slide stores an image as a URL, so
 * every path has to be made absolute against the published site before it
 * can be saved.
 */

/** Site-root-relative, protocol-relative, or already absolute. */
const isAbsolute = url => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url)

/**
 * Builds a resolver for one lecture.
 *
 * `siteBase` is the published origin (plus any path prefix), `coursePath`
 * the course's path on that site, and `deckName` the lecture's slug — which
 * together form the page URL that relative paths are resolved against.
 */
export const makeUrlResolver = ({ siteBase, coursePath, deckName }) => {
  const base = siteBase.replace(/\/+$/, '')
  const page = `${base}/${[coursePath, 'slides', deckName]
    .filter(Boolean)
    .join('/')
    .replace(/^\/+/, '')}/`

  return url => {
    const trimmed = url.trim()
    if (!trimmed) return trimmed
    if (/^(https?:)?\/\//i.test(trimmed)) return trimmed
    // A mailto:, tel: or #anchor target is not a file path.
    if (
      trimmed.startsWith('#') ||
      (isAbsolute(trimmed) && !trimmed.startsWith('/'))
    ) {
      return trimmed
    }
    try {
      return new URL(
        trimmed,
        trimmed.startsWith('/') ? `${base}/` : page,
      ).toString()
    } catch {
      return trimmed
    }
  }
}

/**
 * Rewrites the link and image targets inside a run of markdown so they keep
 * working once the text lives on a slide rather than on the course site.
 */
export const resolveMarkdownUrls = (text, resolve) =>
  text.replace(
    /(!?)\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g,
    (_all, bang, label, url, title) =>
      `${bang}[${label}](${resolve(url)}${title})`,
  )

/**
 * Strips image syntax out of a run of prose, returning the cleaned text and
 * any images found. Prose and pictures live in different slots on a slide,
 * so an image sitting inside a paragraph has to be lifted out of it.
 */
export const extractInlineImages = text => {
  const images = []
  const cleaned = text
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_all, alt, url) => {
      images.push({ alt, url })
      return ''
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text: cleaned, images }
}
