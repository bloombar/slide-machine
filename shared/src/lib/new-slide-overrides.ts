/**
 * GEN-8 admin override defaults, shared by the server (which resolves each
 * switch's effective state during live generation and Refine) and the
 * client (which needs the same default to show the settings checkboxes'
 * effective, not just stored, state).
 *
 * Each switch's value when a lecture has never set it. Overflow promotion
 * (and the Refine box-limit trimming it also gates, GEN-4) defaults OFF: a
 * simulation with it off produced fewer, fuller slides with no clipping
 * visible in the browser (fit-to-box shrink absorbed the rest), so it is now
 * an opt-in admin experiment. The other three keep their original default
 * of ON.
 */
export const NEW_SLIDE_OVERRIDE_DEFAULTS = {
  header: true,
  overflow: false,
  whiteboard: true,
  drawing: true,
} as const
