/**
 * Applies a project's stored lecture order (PROJ-4) to a list of decks
 * that belong to it, so `deck.list` can honour it once and both the
 * project page and the home page follow. Pure and DB-free so it
 * unit-tests directly; the caller supplies decks already sorted
 * newest-first (deck.list's own query order).
 *
 * `lectureOrder` is a hint, not the source of truth:
 *
 *   - a deck missing from it — created, imported or moved in after the
 *     order was set, or the project has never been arranged at all —
 *     sorts FIRST, exactly where a newly recorded lecture has always
 *     appeared. Several such decks keep their newest-first order among
 *     themselves, because that is the order `docs` already arrived in.
 *   - an id in it for a deck no longer in `docs` (soft-deleted) is
 *     silently skipped rather than resurrecting anything. The order is
 *     never edited on delete, so a later restore (P-10) finds its id
 *     still there and the deck reclaims its old position for free.
 */
export const orderByLectureOrder = <D>(
  docs: D[],
  idOf: (doc: D) => string,
  lectureOrder: string[] | undefined,
): D[] => {
  if (!lectureOrder || lectureOrder.length === 0) return docs
  const rank = new Map(lectureOrder.map((id, i) => [id, i]))
  // A stable sort (guaranteed by the spec since ES2019, and what V8/Node
  // implements) keeps unranked decks — all ranked equal, below — in the
  // newest-first order they arrived in.
  return [...docs].sort((a, b) => {
    const ra = rank.get(idOf(a))
    const rb = rank.get(idOf(b))
    if (ra === undefined && rb === undefined) return 0
    if (ra === undefined) return -1
    if (rb === undefined) return 1
    return ra - rb
  })
}
