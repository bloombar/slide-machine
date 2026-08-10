/**
 * A formula, typeset into a picture an export can draw (EXP-7).
 *
 * A maths lecture whose formulas export as `\frac{1}{2}gt^2` is unusable, and
 * that is the whole reason the kind exists. But neither PDF nor pptx has any
 * notion of mathematical notation: both draw text and pictures, and a formula
 * is neither a run of text nor a photograph. So it is typeset here and handed
 * on as an image.
 *
 * MathJax rather than KaTeX because MathJax renders to **SVG** without a
 * browser — real glyph outlines, at any size, from a string. KaTeX produces
 * HTML and CSS, which needs a browser to become anything an exporter can use.
 * The client keeps KaTeX because on screen there is a browser and HTML is
 * lighter; here there is not, and there is no shared answer.
 *
 * The SVG is rasterized rather than passed through as vector art because both
 * exporters take images and neither takes SVG: pptx has no SVG shape, and
 * pdf-lib draws paths one at a time with no notion of a glyph cache. A PNG at
 * export resolution is the honest common denominator.
 *
 * ## Never fatal
 *
 * A formula that will not typeset returns nothing, and the caller says so in
 * the export's report. Refusing to export a lecture because one equation has
 * an unclosed brace would be a far worse trade than a lecture that exports
 * with one formula named as missing.
 */
import sharp from 'sharp'

/** A typeset formula, ready to place. */
export interface TypesetFormula {
  png: Uint8Array
  /** Width ÷ height, so a caller can place it without distorting it. */
  aspect: number
}

/**
 * How tall the raster is, in pixels.
 *
 * Rendered once at a size comfortably above any slide's need and scaled down
 * to the box, rather than rendered per box: downscaling is what stays sharp,
 * and one raster serves the PDF and the presentation alike.
 */
const RENDER_HEIGHT = 320

/** Formulas repeat — the same one across a rebuilt deck, or a slide exported
 * twice — and typesetting is the expensive part. Bounded so a long-lived
 * process cannot grow one entry per formula it has ever seen. */
const cache = new Map<string, TypesetFormula>()
const MAX_CACHED = 128

/** MathJax's document is expensive to build and safe to reuse; it is created
 * on first use so a deployment that never exports never pays for it. */
let converter: ((tex: string) => string) | undefined

const loadConverter = async (): Promise<(tex: string) => string> => {
  if (converter) return converter
  const [
    { mathjax },
    { TeX },
    { SVG },
    { liteAdaptor },
    { RegisterHTMLHandler },
    { AllPackages },
  ] = await Promise.all([
    import('mathjax-full/js/mathjax.js'),
    import('mathjax-full/js/input/tex.js'),
    import('mathjax-full/js/output/svg.js'),
    import('mathjax-full/js/adaptors/liteAdaptor.js'),
    import('mathjax-full/js/handlers/html.js'),
    import('mathjax-full/js/input/tex/AllPackages.js'),
  ])
  const adaptor = liteAdaptor()
  RegisterHTMLHandler(adaptor)
  const doc = mathjax.document('', {
    InputJax: new TeX({
      // Everything except the two extensions whose job is to make a broken
      // formula look fine: `noundefined` draws an unknown macro as its own
      // name and `noerrors` swallows the complaint. Both would have us
      // exporting a picture of the LaTeX source — the one thing EXP-7 says
      // must never happen — instead of saying we could not typeset it.
      packages: AllPackages.filter(
        name => name !== 'noerrors' && name !== 'noundefined',
      ),
    }),
    // `local` inlines the glyph paths in each SVG, so one formula is one
    // self-contained picture rather than a reference to a shared cache that
    // an exported file would not carry.
    OutputJax: new SVG({ fontCache: 'local' }),
  })
  converter = (tex: string) =>
    adaptor.innerHTML(doc.convert(tex, { display: true }))
  return converter
}

/** The `Xex` measurements MathJax states its picture in. */
const exOf = (svg: string, attribute: string): number | undefined => {
  const found = new RegExp(`${attribute}="([\\d.]+)ex"`).exec(svg)
  const value = found ? Number(found[1]) : NaN
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * The formula as a picture, or nothing.
 *
 * `color` is drawn into the SVG because MathJax paints in `currentColor`,
 * which means nothing to a rasterizer with no document around it — left
 * as-is, every formula would come out black on a dark template.
 */
export const typesetFormula = async (
  tex: string,
  color: string,
): Promise<TypesetFormula | null> => {
  const source = tex.trim()
  if (!source) return null
  const key = `${color}|${source}`
  const hit = cache.get(key)
  if (hit) return hit

  try {
    const convert = await loadConverter()
    const svg = convert(source)
    // MathJax reports an error by typesetting the message; a picture of the
    // words "Undefined control sequence" is not what the author meant, and
    // saying nothing lets the report name the formula instead.
    if (/data-mjx-error|merror/.test(svg)) return null

    const width = exOf(svg, 'width')
    const height = exOf(svg, 'height')
    if (!width || !height) return null
    const aspect = width / height

    const sized = svg
      .replace(
        /width="[\d.]+ex"/,
        `width="${Math.round(RENDER_HEIGHT * aspect)}"`,
      )
      .replace(/height="[\d.]+ex"/, `height="${RENDER_HEIGHT}"`)
      .replace(/currentColor/g, color)

    const png = await sharp(Buffer.from(sized)).png().toBuffer()
    const result: TypesetFormula = { png: new Uint8Array(png), aspect }
    // Oldest out first: a deck exported repeatedly keeps its own formulas hot.
    if (cache.size >= MAX_CACHED) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(key, result)
    return result
  } catch {
    return null
  }
}

/** Empties the cache. For tests, which must not inherit one another's state. */
export const resetFormulaCache = (): void => {
  cache.clear()
}
