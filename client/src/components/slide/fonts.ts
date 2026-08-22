/**
 * The font stacks a template may choose from.
 *
 * Deliberately a short fixed list of stacks already on the reader's machine,
 * never a family fetched at display time: a webfont request would tell a third
 * party who is viewing which slide, on every slide view, and would leave the
 * deck unreadable offline or behind a restricted network (docs/TEMPLATES.md
 * §5). The cost is that a template approximates a typeface rather than
 * reproducing it, which is the trade we choose.
 *
 * The key is what gets stored; the stack is what CSS sees.
 */
export interface FontStack {
  /** Stored on the template. Stable — renaming one restyles saved decks. */
  key: string
  /** Shown in the picker. Not translated: these are typeface names. */
  label: string
  /** The CSS `font-family` value. */
  stack: string
}

export const FONT_STACKS: FontStack[] = [
  {
    key: 'sans',
    label: 'System sans',
    stack:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  // The two faces the app BUNDLES (client/src/index.css). Every other entry
  // below names fonts already on the reader's machine and so approximates;
  // these two are the real thing, served from our own origin. A template that
  // names one reproduces its typeface instead of resembling it.
  {
    key: 'frank-ruhl-libre',
    label: 'Frank Ruhl Libre',
    stack:
      '"Frank Ruhl Libre", ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  },
  {
    key: 'montserrat',
    label: 'Montserrat',
    stack:
      'Montserrat, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  {
    key: 'serif',
    label: 'System serif',
    stack: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  },
  {
    key: 'humanist',
    label: 'Humanist',
    stack:
      'Optima, Candara, "Gill Sans", "Gill Sans MT", "Trebuchet MS", sans-serif',
  },
  {
    key: 'geometric',
    label: 'Geometric',
    stack:
      'Futura, "Century Gothic", "Avenir Next", Avenir, "Nunito Sans", sans-serif',
  },
  {
    key: 'mono',
    label: 'Monospace',
    stack:
      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
  },
  // The two below exist for imported decks (TMPL-8). A title set in Oswald or
  // Bebas Neue and a caption in Caveat both used to arrive as plain system
  // sans, which is the difference between a deck that looks like itself and
  // one that looks like everybody else's.
  {
    key: 'condensed',
    label: 'Condensed',
    stack:
      '"Arial Narrow", "Helvetica Neue Condensed", "Liberation Sans Narrow", "Roboto Condensed", Impact, sans-serif',
  },
  {
    key: 'handwritten',
    label: 'Handwritten',
    stack:
      '"Bradley Hand", "Segoe Script", "Chalkboard SE", "Comic Sans MS", cursive',
  },
]

/** The stack a template's stored key means. An unknown key falls back to the
 * first stack rather than to the browser default, so a template saved by a
 * newer client still reads as a deliberate choice. */
export const fontStack = (key: string | undefined): string | undefined => {
  if (!key) return undefined
  return (FONT_STACKS.find(f => f.key === key) ?? FONT_STACKS[0]!).stack
}
