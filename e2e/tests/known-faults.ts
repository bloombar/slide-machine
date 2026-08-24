/**
 * Faults that already exist on the base branch, so a change is not blamed for
 * them — and nothing else.
 *
 * The gate walks every design the app ships, because a design that clips is a
 * design that clips whoever wrote it. That coverage has a cost: a change
 * adding one built-in inherits every other built-in's faults, and a branch
 * cannot be held responsible for those.
 *
 * The tempting answers are both wrong. Scoping the walk to the design under
 * change leaves a gate that has quietly stopped walking four designs.
 * Reporting-but-not-failing decays into permanent tolerance, because nothing
 * ever makes a warning go away.
 *
 * So: every design is walked, every fault is compared against this list, and
 * anything NOT on it fails. The list must shrink and may never silently grow.
 *
 * ## Measured, not assumed
 *
 * Every entry below was produced by running this same gate against
 * `better-faster` at `2aa10ad` in a separate worktree — the base build, its
 * own templates, the same spec. "Almost certainly pre-existing" is not a
 * reason to tolerate a fault; being measured on the base is.
 *
 * Recorded with their numbers so a reader sees what is tolerated rather than
 * inferring it from a green.
 */

/** One tolerated fault: the design, and enough of the message to identify it. */
export interface KnownFault {
  design: string
  /** A distinctive fragment of the fault line, matched as a substring. */
  match: string
  /** What it was measured at on the base, for a reader and for comparison. */
  measured: string
}

export const KNOWN_FAULTS: KnownFault[] = [
  // `two-column` places its title above the top edge of the slide and its
  // body past the bottom, at the design's own declared budgets. Filed
  // separately; not this branch's doing.
  {
    design: 'classic',
    match: 'two-column at its budget "title" runs off the slide',
    measured: 'y -0.035 (above the top edge)',
  },
  {
    design: 'classic',
    match: 'two-column at its budget "body" runs off the slide',
    measured: 'h 0.715 from y 0.320, so the bottom sits at 1.035',
  },
  {
    design: 'midnight',
    match: 'two-column at its budget "title" runs off the slide',
    measured: 'y -0.035 (identical geometry to classic)',
  },
  {
    design: 'midnight',
    match: 'two-column at its budget "body" runs off the slide',
    measured: 'bottom at 1.035 (identical geometry to classic)',
  },
  // A caption that cannot show its own declared budget without going to the
  // shrink floor.
  {
    design: 'classic',
    match: 'image-heavy at its budget "caption" only fits because',
    measured: 'shrunk to 40%, drawn at 7.8px',
  },
  {
    design: 'midnight',
    match: 'image-heavy at its budget "caption" only fits because',
    measured: 'shrunk to 40%, drawn at 7.8px',
  },
  // `seminar` shares that geometry and shows the same three. Measured on the
  // base separately rather than assumed from the other two, because "the same
  // numbers" is what a shared layout and a shared defect both look like.
  {
    design: 'seminar',
    match: 'two-column at its budget "title" runs off the slide',
    measured: 'y -0.035 (above the top edge)',
  },
  {
    design: 'seminar',
    match: 'two-column at its budget "body" runs off the slide',
    measured: 'bottom at 1.035',
  },
  {
    design: 'seminar',
    match: 'image-heavy at its budget "caption" only fits because',
    measured: 'shrunk to 40%, drawn at 7.8px',
  },
]

/**
 * The faults from a walk that are NOT already known on the base.
 *
 * Matching is by substring on a distinctive fragment rather than on the whole
 * line, because the messages carry measured numbers that move — the point is
 * to recognise the same fault, not to freeze its magnitude. A fault that gets
 * worse still matches; catching that is what the numbers in `measured` are
 * for when a human reads the list.
 */
export const unknownFaults = (design: string, faults: string[]): string[] =>
  faults.filter(
    fault =>
      !KNOWN_FAULTS.some(
        known => known.design === design && fault.includes(known.match),
      ),
  )
