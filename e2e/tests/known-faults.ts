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
 * ## Measured, not assumed — and three different things are being measured
 *
 * "Almost certainly pre-existing" is never a reason to tolerate a fault.
 * Being measured is. But the three groups here were measured in three
 * different places, and the fields say which:
 *
 *   - no marker: run against `better-faster` at `2aa10ad` in a separate
 *     worktree, or reproduced identically on both machines. Pre-existing and
 *     machine-independent.
 *   - `platform`: seen in CI and NOT on the development machine. The design
 *     names no typeface, so the number belongs to the face the runner
 *     resolved rather than to the design (TMPL-17).
 *   - `introduced`: created by this branch. One entry, with its whole case.
 *
 * A reader must be able to tell them apart without reading the numbers,
 * because they carry different obligations: the first shrinks when somebody
 * fixes the design, the second when a design states a typeface, and the third
 * when TMPL-16 lands.
 *
 * Recorded with their numbers so a reader sees what is tolerated rather than
 * inferring it from a green.
 *
 * ## No entry here is one this work introduced
 *
 * The mechanism exists so a NEW fault fails rather than joining a list of old
 * ones, which makes putting a new fault on the list the one move this file is
 * built to prevent. It was made once, deliberately, for `nyu-bold`'s section
 * numeral — and then reversed: the numeral was removed from the design
 * altogether, so the fault it reported no longer exists and the entry went
 * with it. The `introduced` field stays because the distinction it draws is
 * the right one; no entry carries it today.
 */

/** One tolerated fault: the design, and enough of the message to identify it. */
export interface KnownFault {
  design: string
  /** A distinctive fragment of the fault line, matched as a substring. */
  match: string
  /** What it was measured at on the base, for a reader and for comparison. */
  measured: string
  /**
   * Present ONLY on a fault this branch introduced, and absent on every
   * pre-existing one.
   *
   * Its value is the argument for accepting it. A pre-existing fault needs no
   * argument — it was there before and the branch is not answerable for it.
   * A new one needs the whole case, because listing it is the thing this file
   * exists to stop.
   */
  introduced?: string
  /**
   * Present ONLY on a fault that does not reproduce on every machine.
   *
   * `classic`, `midnight` and `seminar` name no font family, so every reader
   * gets their platform's own face and the same box measures differently on
   * different machines. Those faults are real for the reader who hits them
   * and absent for the one who does not, so the number recorded is a property
   * of the face the runner resolved rather than of the design.
   *
   * The discriminator was `nyu-elegant`, which names a real face: its nine
   * faults were byte-identical here and in CI, while the three faceless
   * designs disagree between machines and agree byte for byte with EACH
   * OTHER. That is what made this a measurement rather than a story about
   * fonts. Both designs that name their faces now carry no entries at all,
   * so the discriminator is gone with them — every entry below belongs to a
   * faceless design, and the claim rests on the measurement that was taken
   * rather than on a control still present in the file.
   *
   * It is also what a stale-entry check would have to exempt: an entry that
   * legitimately does not reproduce here cannot be required to match.
   */
  platform?: string
}

/** The caveat every faceless design's entry carries, written once. */
const PLATFORM_FACE =
  'CI only. This design names no typeface, so the runner resolved the system ' +
  "stack to a face with different metrics from this machine's, and the box " +
  'shrank where it does not shrink locally. TMPL-17.'

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

  // ---- The three designs that name no typeface ----
  //
  // Four faults each, IDENTICAL across all three: same layouts, same boxes,
  // same pixel sizes, same percentages. Three designs agreeing byte for byte
  // is what one shared system face looks like, and not one of the four
  // appears on this machine at all.
  {
    design: 'classic',
    match: 'content-list at its budget "body" only fits because',
    measured:
      'shrunk to 90%, drawn 24.2px against a design size of 26.8px, box 859x118, 200 chars',
    platform: PLATFORM_FACE,
  },
  {
    design: 'classic',
    match: 'content-list at its budget "bullets" only fits because',
    measured:
      'shrunk to 88%, drawn 23.5px against 26.8px, box 859x199, 280 chars',
    platform: PLATFORM_FACE,
  },
  {
    design: 'classic',
    match: 'list at its budget "bullets" only fits because',
    measured:
      'shrunk to 85%, drawn 22.8px against 26.8px, box 859x268, 420 chars',
    platform: PLATFORM_FACE,
  },
  {
    design: 'classic',
    match: 'quote at its budget "body" only fits because',
    measured:
      'shrunk to 95%, drawn 37.1px against 39.0px, box 820x389, 202 chars',
    platform: PLATFORM_FACE,
  },
  {
    design: 'midnight',
    match: 'content-list at its budget "body" only fits because',
    measured:
      'shrunk to 90%, drawn 24.2px against a design size of 26.8px, box 859x118, 200 chars',
    platform: PLATFORM_FACE,
  },
  {
    design: 'midnight',
    match: 'content-list at its budget "bullets" only fits because',
    measured:
      'shrunk to 88%, drawn 23.5px against 26.8px, box 859x199, 280 chars',
    platform: PLATFORM_FACE,
  },
  {
    design: 'midnight',
    match: 'list at its budget "bullets" only fits because',
    measured:
      'shrunk to 85%, drawn 22.8px against 26.8px, box 859x268, 420 chars',
    platform: PLATFORM_FACE,
  },
  {
    design: 'midnight',
    match: 'quote at its budget "body" only fits because',
    measured:
      'shrunk to 95%, drawn 37.1px against 39.0px, box 820x389, 202 chars',
    platform: PLATFORM_FACE,
  },
  {
    design: 'seminar',
    match: 'content-list at its budget "body" only fits because',
    measured:
      'shrunk to 90%, drawn 24.2px against a design size of 26.8px, box 859x118, 200 chars',
    platform: PLATFORM_FACE,
  },
  {
    design: 'seminar',
    match: 'content-list at its budget "bullets" only fits because',
    measured:
      'shrunk to 88%, drawn 23.5px against 26.8px, box 859x199, 280 chars',
    platform: PLATFORM_FACE,
  },
  {
    design: 'seminar',
    match: 'list at its budget "bullets" only fits because',
    measured:
      'shrunk to 85%, drawn 22.8px against 26.8px, box 859x268, 420 chars',
    platform: PLATFORM_FACE,
  },
  {
    design: 'seminar',
    match: 'quote at its budget "body" only fits because',
    measured:
      'shrunk to 95%, drawn 37.1px against 39.0px, box 820x389, 202 chars',
    platform: PLATFORM_FACE,
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
