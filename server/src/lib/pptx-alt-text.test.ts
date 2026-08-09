/**
 * Unit tests for putting alt text on a generated .pptx's shapes (EXP-8).
 *
 * This pass exists because the generator writes alt text for pictures and
 * charts and silently ignores it on a text shape — so the file is finished and
 * then amended. What the tests hold it to is that it amends exactly the shapes
 * this system named, leaves everything else as it found it, and never turns a
 * problem of its own into a failed export.
 */
import { describe, it, expect } from 'vitest'
import AdmZip from 'adm-zip'
import { withSlotAltText } from './pptx-alt-text'

/** A .pptx-shaped zip holding one part, so the pass has something to amend. */
const zipWith = (
  entryName: string,
  xml: string,
): { bytes: Uint8Array; read: (bytes: Uint8Array) => string } => {
  const zip = new AdmZip()
  zip.addFile(entryName, Buffer.from(xml, 'utf8'))
  return {
    bytes: new Uint8Array(zip.toBuffer()),
    read: bytes => new AdmZip(Buffer.from(bytes)).readAsText(entryName),
  }
}

const shape = (name: string, extra = ''): string =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="${name}"${extra}></p:cNvPr></p:nvSpPr></p:sp>`

const LAYOUT = 'ppt/slideLayouts/slideLayout2.xml'

describe('the shapes this system named', () => {
  it('are described by the slot they are', () => {
    const { bytes, read } = zipWith(LAYOUT, shape('slot:title'))
    // Alt text is the field Google keeps and never shows as slide content, so
    // it is where a slot's identity has to end up
    expect(read(withSlotAltText(bytes))).toContain(
      '<p:cNvPr id="2" name="slot:title" descr="slot:title">',
    )
  })

  it('carry their payload the same way', () => {
    const payload = '{&quot;slidemachine&quot;:1,&quot;slots&quot;:[]}'
    const { bytes, read } = zipWith(LAYOUT, shape(payload))
    expect(read(withSlotAltText(bytes))).toContain(`descr="${payload}"`)
  })

  it('are amended on the slides as well as the layouts', () => {
    // Metadata on the layouts is what lets a template round-trip; metadata on
    // the slides is what lets a deck
    const { bytes, read } = zipWith('ppt/slides/slide1.xml', shape('slot:body'))
    expect(read(withSlotAltText(bytes))).toContain('descr="slot:body"')
  })
})

describe('everything else', () => {
  it('is left exactly as it was', () => {
    const { bytes, read } = zipWith(LAYOUT, shape('Text 3'))
    // A shape nobody named is not a slot, and inventing alt text for it would
    // be a description that says nothing to whoever hears it read out
    expect(read(withSlotAltText(bytes))).not.toContain('descr=')
  })

  it('keeps a description that was already there', () => {
    // A picture's alt text describes the picture, which is worth more than
    // repeating its name
    const { bytes, read } = zipWith(
      LAYOUT,
      shape('slot:image', ' descr="A diagram of the Krebs cycle"'),
    )
    const out = read(withSlotAltText(bytes))
    expect(out).toContain('descr="A diagram of the Krebs cycle"')
    expect(out).not.toContain('descr="slot:image"')
  })

  it('is untouched in a part that holds no shapes of ours', () => {
    const { bytes } = zipWith('docProps/app.xml', shape('slot:title'))
    // Only layouts, slides and masters are amended; rewriting the rest would
    // be work with no reader
    expect(withSlotAltText(bytes)).toBe(bytes)
  })
})

describe('when the file cannot be reopened', () => {
  it('comes back as it went in', () => {
    // Losing the metadata costs a future import its shortcut and it infers the
    // design instead — which is what every foreign presentation gets anyway.
    // Failing the export over it would be a far worse trade.
    const notAZip = new Uint8Array([1, 2, 3, 4])
    expect(withSlotAltText(notAZip)).toBe(notAZip)
  })
})
