/**
 * Shared phrasing for the tool surface (docs/MCP.md §4.1).
 *
 * These read as trivia and are not. A tool's prose is the part the model
 * reasons over, so a project that prints one way in `find_lectures` and
 * another in `find_projects` is a model being told two things about one
 * record. One definition, used by both, is what keeps that from happening.
 */

/** A date as a model should read it: unambiguous, no locale in play. */
export const onDay = (value: string | Date | undefined): string =>
  value ? new Date(value).toISOString().slice(0, 10) : 'unknown'

/**
 * How a project is named, including when it has no name.
 *
 * Three cases, and they mean different things. A title is genuinely optional —
 * the project created for a user's first lecture has none, and the app shows a
 * placeholder — so an empty one is ordinary and says "untitled". A title that
 * is missing entirely means the project was not in the listing at all, which
 * is not ordinary, and flattening the two would tell a model that a lookup
 * failure and an unnamed project are the same thing.
 *
 * Passing the empty string straight through printed `in project ""`, which
 * reads as broken data rather than an absent name.
 */
export const projectName = (title: string | undefined): string =>
  title === undefined ? 'unknown' : title.trim() ? title : 'Untitled project'

/**
 * The clause that tells a reader where to open something, or nothing at all
 * when there is no link to give (deck-link.ts explains when that happens).
 *
 * A separate helper because the alternative — an `undefined` interpolated into
 * a template string — prints the word "undefined" at the end of a sentence,
 * which a model will happily repeat to the user as if it were an address.
 */
export const openAt = (url: string | undefined): string =>
  url ? `, open at ${url}` : ''
