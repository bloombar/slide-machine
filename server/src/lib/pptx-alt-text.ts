/**
 * Puts alt text on the shapes of a generated .pptx (EXP-8).
 *
 * Slot metadata rides in alt text because Google preserves it and never shows
 * it as slide content. The generator, though, writes alt text only for
 * pictures and charts — a text shape's `descr` attribute is simply not
 * emitted, so asking it for one is silently ignored.
 *
 * Rather than fork the generator, the file is finished and then amended. A
 * .pptx is a zip of XML, the shapes that need alt text are exactly the ones
 * this system named, and `descr` is one attribute on one element. So the pass
 * is: find every shape whose name is one of ours, and give it a description
 * saying the same thing.
 *
 * Copying the name rather than carrying a separate table is deliberate. The
 * name is already in the file, already XML-escaped by the generator, and
 * already unique per shape — a second table keyed by anything else would be
 * one more thing to keep in step.
 */
import AdmZip from 'adm-zip'

/** Parts whose shapes may be slots: a presentation's layouts, and its slides.
 * Metadata on the layouts is what lets a template round-trip; metadata on the
 * slides is what lets a deck. */
const AMENDABLE = /^ppt\/(slideLayouts|slides|slideMasters)\/[^/]+\.xml$/

/** A shape name this system wrote, and therefore one worth describing: a slot
 * token, or a metadata payload. */
const isOurs = (name: string): boolean =>
  name.startsWith('slot:') || name.startsWith('{&quot;slidemachine&quot;')

/**
 * The same XML with `descr` added to every shape this system named.
 *
 * Shapes that already carry a description are left alone: a picture's alt text
 * is written by the generator and describes the picture, which is worth more
 * than repeating its name.
 */
const amend = (xml: string): string =>
  xml.replace(
    /<p:cNvPr ([^>]*?)name="([^"]*)"([^>]*?)>/g,
    (whole, before: string, name: string, after: string) => {
      if (!isOurs(name) || /\bdescr=/.test(whole)) return whole
      return `<p:cNvPr ${before}name="${name}" descr="${name}"${after}>`
    },
  )

/**
 * The presentation with its slot metadata readable.
 *
 * Never fatal: a file that cannot be reopened is returned as it was. Losing
 * the metadata costs a future import its shortcut, and it falls back to
 * inferring the design — which is what happens for every presentation from
 * anywhere else anyway.
 */
export const withSlotAltText = (bytes: Uint8Array): Uint8Array => {
  try {
    const zip = new AdmZip(Buffer.from(bytes))
    let changed = false
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !AMENDABLE.test(entry.entryName)) continue
      const xml = entry.getData().toString('utf8')
      const amended = amend(xml)
      if (amended === xml) continue
      zip.updateFile(entry.entryName, Buffer.from(amended, 'utf8'))
      changed = true
    }
    return changed ? new Uint8Array(zip.toBuffer()) : bytes
  } catch {
    return bytes
  }
}
