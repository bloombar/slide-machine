/**
 * A short description for a template card (TMPL-28): the opening of its
 * `aiInstructions`, cut at a word boundary so the tail is never a fragment
 * of the last word rather than the word itself.
 *
 * Pure and shared so the server (the only place `aiInstructions` is read
 * today) and a future client render can agree on exactly what a card shows
 * without restating the rule.
 */

/** The recommended ceiling on a template card's description (TMPL-28). */
export const TEMPLATE_DESCRIPTION_CHARS = 160

/**
 * Cuts `aiInstructions` down to `TEMPLATE_DESCRIPTION_CHARS`, collapsing
 * whitespace (including newlines) first so a multi-line instructions field
 * reads as one line. Text at or under the limit is returned whole, with no
 * trailing mark — only a genuine cut earns the "…", and the result including
 * that mark is never longer than the limit.
 *
 * The budget for the text itself is one less than the limit, reserving room
 * for the "…" so `<=160 chars> + '…'` cannot itself run over. Within that
 * budget, a cut prefers the last word boundary — but only when that boundary
 * is not too early: a name whose first space sits at position 3 would
 * otherwise produce "Hi…", which says almost nothing. When the last space
 * falls before half the budget, the text is hard-cut at the budget instead,
 * the same fallback a genuinely unbroken word already gets.
 */
export const templateDescription = (aiInstructions?: string): string => {
  const text = (aiInstructions ?? '').trim().replace(/\s+/g, ' ')
  if (!text) return ''
  if (text.length <= TEMPLATE_DESCRIPTION_CHARS) return text
  const budget = TEMPLATE_DESCRIPTION_CHARS - 1 // room for the trailing "…"
  const cut = text.slice(0, budget)
  const lastSpace = cut.lastIndexOf(' ')
  const atWord = lastSpace >= budget / 2 ? cut.slice(0, lastSpace) : cut
  return `${atWord}…`
}
