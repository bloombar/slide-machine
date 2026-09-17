/**
 * GEN-8 admin overrides: live generation sometimes overrules the model's own
 * "update the current slide" decision and turns it into a NEW slide (a
 * header/title slide that would otherwise swallow real content, an update
 * that would overflow its slide, a whiteboard canvas that cannot show text),
 * or the reverse (folding a would-be new slide into the current one while a
 * drawing is in progress). An allowlisted admin can switch any of them per
 * lecture, from the settings modal, to see what live generation does with a
 * different setting than its default.
 *
 * The overflow switch also governs Refine's box-limit trimming (GEN-4): see
 * actions/reconcile.ts.
 *
 * NEW_SLIDE_OVERRIDE_DEFAULTS lives in shared/ (re-exported here) so the
 * client's settings checkboxes agree with the server on each switch's
 * default without duplicating it.
 */
export { NEW_SLIDE_OVERRIDE_DEFAULTS } from '@slide-machine/shared'

/** Resolves one override's effective state: an explicit stored value wins,
 * otherwise it falls back to that switch's default above. */
export const isNewSlideOverrideOn = (
  value: boolean | undefined,
  defaultOn: boolean = true,
): boolean => value ?? defaultOn
