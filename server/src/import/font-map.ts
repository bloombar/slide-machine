/**
 * Which of the app's own font stacks a presentation's typeface becomes.
 *
 * Its own module because two stages need it and neither can own it: the
 * importer maps a box's family as it builds the box, and the type scale maps
 * every box's family BEFORE deciding whether a role's boxes agree on one
 * (`type-scale.ts`). Agreement has to be judged on the stack rather than on
 * the source name — two boxes set in Helvetica and Arial are one typeface as
 * far as anything here can reproduce, and treating them as a disagreement
 * would leave the role silent about a family both boxes share.
 */
const FONT_FAMILIES: { key: string; pattern: RegExp }[] = [
  // The faces the app bundles, first and by name. Everything below this pair
  // answers "what does it most resemble"; these two answer "it is this one",
  // so a deck set in Montserrat comes back in Montserrat rather than in a
  // geometric sans that is merely like it.
  { key: 'frank-ruhl-libre', pattern: /frank\s*ruhl/i },
  { key: 'montserrat', pattern: /^\s*montserrat/i },
  // Monospace first: "Courier New" reads as serif by name and is monospaced
  // in fact, and being fixed-width is the property that matters.
  {
    key: 'mono',
    pattern:
      /(mono|courier|consol|menlo|code|typewriter|inconsolata|jetbrains|anonymous pro)/i,
  },
  // Then the hand-drawn ones, before anything that could claim them by a
  // shared word: "Brush Script" is a hand, not a serif.
  {
    key: 'handwritten',
    pattern:
      /(caveat|indie flower|pacifico|dancing script|comic sans|shadows into light|patrick hand|kalam|architects daughter|permanent marker|satisfy|courgette|gloria hallelujah|handlee|bradley hand|segoe script|brush script|chalkboard|marker felt|script|handwrit)/i,
  },
  // Narrow display faces, which a title in Oswald or Bebas depends on: set in
  // an ordinary sans they lose the line breaks the author wrote around them.
  {
    key: 'condensed',
    pattern:
      /(oswald|bebas|anton|archivo black|impact|narrow|condensed|teko|fjalla|haettenschweiler|league gothic)/i,
  },
  {
    key: 'geometric',
    // `montserrat` is gone from this list: it is matched by name above. A
    // variant that is not the face itself ("Montserrat Alternates") still
    // lands here, which is right — it resembles Montserrat, it is not it.
    pattern:
      /(futura|century gothic|avenir|nunito|poppins|jost|raleway|josefin|quicksand|comfortaa|questrial|urbanist|outfit|didact)/i,
  },
  {
    key: 'humanist',
    pattern:
      /(optima|candara|gill sans|trebuchet|tahoma|verdana|lato|calibri|corbel|myriad|frutiger|segoe ui|ubuntu|pt sans|cabin|karla)/i,
  },
  {
    key: 'serif',
    pattern:
      /(times|georgia|garamond|cambria|palatino|baskerville|merriweather|playfair|didot|lora|cardo|spectral|crimson|bookman|book antiqua|constantia|caslon|cormorant|slab|arvo|rockwell|bitter|museo|vollkorn|tinos|droid serif|pt serif|noto serif|source serif|libre|serif)/i,
  },
]

/** The stack closest to a font nobody can be asked to download. Anything
 * unrecognized is sans, which is what most presentation type is. */
export const mapFont = (family: string | undefined): string | undefined => {
  if (!family?.trim()) return undefined
  return FONT_FAMILIES.find(f => f.pattern.test(family))?.key ?? 'sans'
}
