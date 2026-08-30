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
