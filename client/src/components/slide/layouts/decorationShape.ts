/**
 * The outline a decoration piece is cut to (TMPL-8).
 *
 * A presentation's shapes are not all rectangles. An arrow across the top of a
 * slide is an arrow, and importing it as a grey box is the single most visible
 * way a design stops looking like itself — the deck says "and then this", the
 * import says "here is a rectangle".
 *
 * Google names about a hundred and eighty shapes. These are the ones a slide
 * deck is actually built from; anything else is drawn as the rectangle it is
 * bounded by, which is what the piece was before any of this and is never
 * wrong, only plain.
 *
 * `clip-path` rather than SVG because a piece is already a positioned box with
 * a fill or a picture — clipping keeps one element doing one job, and a
 * background image is clipped by it just as a colour is.
 */

/** Percentage polygons, drawn clockwise from the top-left of the piece. */
const POLYGONS: Record<string, string> = {
  // Arrows: a shaft two-thirds deep, a head across the last quarter.
  RIGHT_ARROW:
    'polygon(0% 25%, 75% 25%, 75% 0%, 100% 50%, 75% 100%, 75% 75%, 0% 75%)',
  LEFT_ARROW:
    'polygon(100% 25%, 25% 25%, 25% 0%, 0% 50%, 25% 100%, 25% 75%, 100% 75%)',
  UP_ARROW:
    'polygon(25% 100%, 25% 25%, 0% 25%, 50% 0%, 100% 25%, 75% 25%, 75% 100%)',
  DOWN_ARROW:
    'polygon(25% 0%, 25% 75%, 0% 75%, 50% 100%, 100% 75%, 75% 75%, 75% 0%)',
  LEFT_RIGHT_ARROW:
    'polygon(0% 50%, 20% 0%, 20% 25%, 80% 25%, 80% 0%, 100% 50%, 80% 100%, 80% 75%, 20% 75%, 20% 100%)',
  BENT_ARROW: 'polygon(0% 100%, 0% 40%, 60% 40%, 60% 0%, 100% 55%, 60% 100%)',

  CHEVRON: 'polygon(0% 0%, 75% 0%, 100% 50%, 75% 100%, 0% 100%, 25% 50%)',
  HOME_PLATE: 'polygon(0% 0%, 75% 0%, 100% 50%, 75% 100%, 0% 100%)',

  TRIANGLE: 'polygon(50% 0%, 100% 100%, 0% 100%)',
  RIGHT_TRIANGLE: 'polygon(0% 0%, 0% 100%, 100% 100%)',
  DIAMOND: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  PENTAGON: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)',
  HEXAGON: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
  OCTAGON:
    'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)',
  TRAPEZOID: 'polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%)',
  PARALLELOGRAM: 'polygon(25% 0%, 100% 0%, 75% 100%, 0% 100%)',

  STAR_4:
    'polygon(50% 0%, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0% 50%, 38% 38%)',
  STAR_5:
    'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
  STAR_6:
    'polygon(50% 0%, 66% 25%, 100% 25%, 83% 50%, 100% 75%, 66% 75%, 50% 100%, 34% 75%, 0% 75%, 17% 50%, 0% 25%, 34% 25%)',
}

/** Shapes that are an ellipse rather than a polygon. */
const ELLIPSES = new Set(['ELLIPSE', 'OVAL', 'CIRCLE', 'FLOW_CHART_CONNECTOR'])

/**
 * The CSS `clip-path` for a shape, or nothing when it is a rectangle — either
 * because the presentation said so, or because we do not know the shape and a
 * rectangle is the honest fallback.
 */
export const clipPathFor = (shape: string | undefined): string | undefined => {
  if (!shape) return undefined
  const name = shape.toUpperCase()
  if (ELLIPSES.has(name)) return 'ellipse(50% 50% at 50% 50%)'
  return POLYGONS[name]
}
