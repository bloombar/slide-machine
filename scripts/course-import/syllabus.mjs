/**
 * Reads a course's syllabus for the description its project is seeded with.
 *
 * A course directory holds a `syllabus.md` beside its `slides/` — the same
 * Jekyll-flavoured markdown the lectures are written in, opening with a
 * frontmatter block and carrying a `## Course description` section. That
 * section is the paragraph a reader would recognise as "what this course is",
 * so it is what a project's description is taken from.
 *
 * Everything here is pure apart from reading the file.
 */
import fs from 'node:fs'
import path from 'node:path'

/** The heading a course's own description sits under, however it is cased. */
const DESCRIPTION_HEADING = /^#{1,6}\s+course\s+description\s*$/i

/** Any heading line — where the description section stops. */
const ANY_HEADING = /^#{1,6}\s+/

/** Drops a leading `---` frontmatter block, which is metadata, not prose. */
const stripFrontmatter = text => {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return lines
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  return end === -1 ? lines : lines.slice(end + 1)
}

/**
 * Flattens the markdown a description paragraph may carry, so the stored text
 * reads as prose rather than as markup: links keep their label and lose their
 * target, and emphasis marks are dropped.
 */
const plainText = text =>
  text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\W)[*_]([^*_]+)[*_](?=\W|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The prose under a syllabus's "Course description" heading.
 *
 * Only the paragraphs directly beneath it are taken — the section ends at the
 * next heading of any level, so the sub-sections a syllabus puts after it
 * (credits, modality, meeting pattern) are left out. Returns null when the
 * file has no such section, which is not an error: the caller falls back.
 */
export const descriptionFromSyllabus = (text, { maxLength = 2000 } = {}) => {
  const lines = stripFrontmatter(String(text ?? ''))
  const start = lines.findIndex(line => DESCRIPTION_HEADING.test(line.trim()))
  if (start === -1) return null

  const body = []
  for (const line of lines.slice(start + 1)) {
    if (ANY_HEADING.test(line.trim())) break
    body.push(line)
  }

  // Paragraphs, not one run-on: a blank line separates them in the source.
  const paragraphs = body
    .join('\n')
    .split(/\n\s*\n/)
    .map(plainText)
    .filter(Boolean)
  if (!paragraphs.length) return null

  // Whole paragraphs only — a description cut mid-sentence reads as damage.
  const kept = []
  let length = 0
  for (const paragraph of paragraphs) {
    const added = length ? length + 2 + paragraph.length : paragraph.length
    if (kept.length && added > maxLength) break
    kept.push(paragraph)
    length = added
  }
  return kept.join('\n\n').slice(0, maxLength)
}

/** Where a course keeps its syllabus: beside the `slides/` directory. */
export const syllabusPathFor = dir =>
  path.join(path.dirname(dir), 'syllabus.md')

/**
 * The description for the course whose lectures live in `dir`, or null when
 * there is no syllabus to read or it has no description section.
 */
export const readCourseDescription = (dir, { syllabusPath } = {}) => {
  const file = syllabusPath ?? syllabusPathFor(dir)
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  return descriptionFromSyllabus(text)
}
