/**
 * GEN-8 admin overrides: live generation sometimes overrules the model's own
 * "update the current slide" decision and turns it into a NEW slide (a
 * header/title slide that would otherwise swallow real content, an update
 * that would overflow its slide, a whiteboard canvas that cannot show text),
 * or the reverse (folding a would-be new slide into the current one while a
 * drawing is in progress). Each of the four is on by default — an
 * allowlisted admin can switch any of them off per lecture, from the
 * settings modal, to see what live generation does without it.
 *
 * The overflow switch also governs Refine's box-limit trimming (GEN-4): see
 * actions/reconcile.ts.
 */

/** One override's stored value: absent/undefined means ON, matching every
 * other lecture-level toggle (refineSlidesEnabled, etc.). */
export const isNewSlideOverrideOn = (value: boolean | undefined): boolean =>
  value !== false
