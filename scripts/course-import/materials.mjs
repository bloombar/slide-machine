/**
 * Finds the pictures and documents a lecture links to and prepares them to be
 * uploaded as that lecture's seed material (SEED-1).
 *
 * Two problems have to be solved before a link becomes a file on disk:
 *
 * - **The paths are written for the published page, not the file.** A lecture
 *   is served at `/…/slides/<lecture>/`, so `../images/x.png` in the source
 *   means `slides/images/x.png` — the leading `../` climbs out of the page's
 *   own directory, which is why it looks like one `../` too many next to the
 *   markdown file. Candidates are tried in that order, most-correct first.
 * - **Only some files are worth sending.** The upload route accepts PDF,
 *   DOCX, PNG, JPEG and WebP and nothing else, so anything outside that set
 *   is reported rather than sent, and cross-lecture links (which have no file
 *   extension at all) are never mistaken for files.
 *
 * Everything here is pure — paths and text in, plain objects out — apart from
 * the existence checks used to pick between candidate paths.
 */
import fs from 'node:fs'
import path from 'node:path'

/** What the upload route accepts, by extension (server/src/routes/seed-assets.ts). */
const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

/** The route's own cap; a bigger file is skipped rather than rejected. */
export const MAX_MATERIAL_BYTES = 20 * 1024 * 1024

/** The upload MIME type for a path, or null when the route would refuse it. */
export const mimeFor = filePath =>
  MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? null

/** Drops a Jekyll `{{ … }}` template variable and any trailing query/anchor. */
const cleanTarget = url =>
  url
    .replace(/\{\{[^}]*\}\}/g, '')
    .split('#')[0]
    .split('?')[0]
    .trim()

/** Extensions worth reporting on: the ones the route takes, plus the
 * near-misses an instructor would want told about (a `.gif` or `.svg`
 * diagram, a `.doc` handout). A web page and a link to another
 * lecture are neither — `../version-control-systems` and `…/index.htm` are
 * navigation, not material. */
const MATERIAL_EXT =
  /\.(pdf|docx?|pptx?|png|jpe?g|webp|gif|svg|bmp|tiff?|txt|md|csv|drawio)$/i

/** A target that names a file rather than a page, anchor or address. */
export const isMaterialLink = url => {
  const trimmed = cleanTarget(url)
  if (!trimmed) return false
  if (/^(mailto:|tel:|data:|javascript:)/i.test(trimmed)) return false
  return MATERIAL_EXT.test(trimmed)
}

/**
 * Markdown link and image targets, with their label or alt text.
 *
 * The target may open with a Jekyll `{{ site.baseurl }}` variable, which
 * contains spaces — so the usual "no whitespace in a URL" rule has to allow
 * for one leading `{{ … }}` before it applies.
 */
const LINK_RE =
  /(!?)\[([^\]]*)\]\(\s*((?:\{\{[^}]*\}\})?[^)\s]*)(?:\s+"[^"]*")?\s*\)/g

/** Every text field a link could hide in — a code listing is not one. */
const blockText = block => {
  switch (block.type) {
    case 'code':
      return []
    case 'image':
      return [`![${block.alt ?? ''}](${block.url})`]
    case 'table':
      return [...(block.header ?? []), ...(block.rows ?? []).flat()]
    case 'list':
      return block.items ?? []
    default:
      return [block.text, block.caption].filter(Boolean)
  }
}

/**
 * Collects every file a parsed lecture links to, in source order and
 * de-duplicated by target, keeping the slide heading each was found under so
 * the upload can be labelled with the topic it illustrates.
 */
export const collectMaterialLinks = parsed => {
  const found = new Map()
  for (const slide of parsed.slides ?? []) {
    for (const block of slide.blocks ?? []) {
      for (const text of blockText(block)) {
        for (const match of String(text).matchAll(LINK_RE)) {
          const [, bang, label, url] = match
          if (!isMaterialLink(url)) continue
          if (found.has(url)) continue
          found.set(url, {
            url,
            label: label.trim(),
            isImage: bang === '!',
            section: slide.section ?? '',
          })
        }
      }
    }
  }
  return [...found.values()]
}

/**
 * Disk paths a link could mean, most-correct first.
 *
 * `dir` is the lecture directory, `deckName` the lecture's slug — together
 * the page the source is published at. A site-absolute path is matched by
 * its tail, because the course's own path prefix is already on disk.
 */
export const candidatePaths = (url, { dir, deckName }) => {
  const target = cleanTarget(url)
  if (!target || /^(https?:)?\/\//i.test(target)) return []
  const courseRoot = path.dirname(dir)
  const candidates = []

  if (target.startsWith('/')) {
    // `/content/courses/<course>/slides/images/x.png` — try progressively
    // shorter tails against the course root and the lecture directory.
    const parts = target.replace(/^\/+/, '').split('/')
    for (let i = 0; i < parts.length; i++) {
      const tail = parts.slice(i).join('/')
      candidates.push(path.resolve(courseRoot, tail), path.resolve(dir, tail))
    }
  } else {
    // Relative to the published page — the reading that makes the source's
    // "extra" `../` correct — then to the file, then with that `../` removed.
    candidates.push(path.resolve(dir, deckName, target))
    candidates.push(path.resolve(dir, target))
    candidates.push(path.resolve(dir, target.replace(/^(?:\.\.\/)+/, '')))
    candidates.push(
      path.resolve(courseRoot, target.replace(/^(?:\.\.\/)+/, '')),
    )
  }

  // Last resort: the file by name in the directories assets actually live in.
  const base = path.basename(target)
  candidates.push(
    path.resolve(dir, 'images', base),
    path.resolve(dir, 'assets', deckName, base),
  )

  return [...new Set(candidates)]
}

/** The first candidate that exists as a readable file, or null. */
export const resolveMaterialPath = (url, ctx) => {
  for (const candidate of candidatePaths(url, ctx)) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // Not there — try the next reading of the path.
    }
  }
  return null
}

/** "software_lifecycles_waterfall.png" → "software lifecycles waterfall". */
const nameWords = filePath =>
  path
    .basename(filePath, path.extname(filePath))
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The label the generator will match against.
 *
 * A caption is the only thing an uploaded picture is offered to generation
 * by (`caption ?? name`, with its keywords derived from the caption's own
 * words), so it is built from everything that says what the file is about:
 * the alt text or link label, the slide heading it illustrates, the lecture,
 * and the filename. Duplicated words are dropped so one topic said three
 * ways does not crowd out the rest.
 */
export const captionFor = ({ label, section, lectureTitle, filePath }) => {
  const seen = new Set()
  const parts = []
  for (const part of [label, section, lectureTitle, nameWords(filePath)]) {
    const text = String(part ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    // Skip a part whose words are all already present.
    const words = key.split(/[^a-z0-9]+/).filter(w => w.length > 2)
    if (words.length && words.every(w => seen.has(w))) continue
    seen.add(key)
    for (const word of words) seen.add(word)
    parts.push(text)
  }
  return parts.join(' — ').slice(0, 500)
}

/**
 * Resolves a lecture's links into the material that can actually be sent,
 * alongside what was found but skipped and why — an import reports both.
 *
 * `resolve` is the lecture's URL resolver, recorded per upload so a picture
 * box pointed at the published site can later be repointed at the copy that
 * was uploaded — the site may not serve the file the local source names.
 */
export const materialsFor = (
  parsed,
  { dir, deckName, lectureTitle, resolve = url => url },
) => {
  const uploads = []
  const skipped = []
  const seenFiles = new Set()

  for (const link of collectMaterialLinks(parsed)) {
    const filePath = resolveMaterialPath(link.url, { dir, deckName })
    if (!filePath) {
      skipped.push({
        ...link,
        reason: /^(https?:)?\/\//i.test(link.url.trim()) ? 'remote' : 'missing',
      })
      continue
    }
    const mime = mimeFor(filePath)
    if (!mime) {
      skipped.push({ ...link, filePath, reason: 'unsupported' })
      continue
    }
    let size
    try {
      size = fs.statSync(filePath).size
    } catch {
      skipped.push({ ...link, filePath, reason: 'missing' })
      continue
    }
    if (size > MAX_MATERIAL_BYTES) {
      skipped.push({ ...link, filePath, size, reason: 'too-large' })
      continue
    }
    // One file linked from several slides is one upload.
    if (seenFiles.has(filePath)) continue
    seenFiles.add(filePath)

    uploads.push({
      url: link.url,
      // The URL the slide's picture box was given for this same link, so the
      // box can be repointed at the uploaded copy once it exists.
      resolvedUrl: resolve(link.url),
      filePath,
      name: path.basename(filePath),
      mime,
      size,
      caption: captionFor({ ...link, lectureTitle, filePath }),
    })
  }

  return { uploads, skipped }
}
