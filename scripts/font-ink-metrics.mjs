#!/usr/bin/env node
/**
 * Reads the ink extents of the two typefaces this app bundles.
 *
 *   node scripts/font-ink-metrics.mjs
 *
 * Prints the table that `shared/src/types/text-ink.ts` carries as constants.
 * The constants are committed rather than read at runtime — the font files
 * live in `node_modules` and neither the server nor a template build should
 * depend on a package layout — so this exists to re-derive them when a face
 * is upgraded, and to show they were measured rather than typed.
 *
 * What it reads, per face:
 *   - `ascender` and `descender` from `hhea`, which is where a browser gets
 *     the box it centres in a line box.
 *   - per-glyph `yMin`/`yMax` from `glyf`, which is the INK — how far a
 *     glyph actually reaches above and below its baseline.
 *
 * Two glyph sets, because a box's reachable ink depends on how it is set:
 *   - `text`: unaccented letters and digits, the assumption the overlap rule
 *     states (see `text-ink.ts` for what that excludes).
 *   - `caps`: the same set uppercased, for a box drawn with
 *     `text-transform: uppercase`, which cannot receive a lowercase
 *     descender.
 */
import fs from 'node:fs'
import zlib from 'node:zlib'

const FACES = [
  [
    'montserrat',
    400,
    '@fontsource/montserrat/files/montserrat-latin-400-normal.woff',
  ],
  [
    'montserrat',
    700,
    '@fontsource/montserrat/files/montserrat-latin-700-normal.woff',
  ],
  [
    'frank-ruhl-libre',
    400,
    '@fontsource/frank-ruhl-libre/files/frank-ruhl-libre-latin-400-normal.woff',
  ],
  [
    'frank-ruhl-libre',
    700,
    '@fontsource/frank-ruhl-libre/files/frank-ruhl-libre-latin-700-normal.woff',
  ],
]

/** WOFF is a table directory of possibly-deflated SFNT tables. */
const tablesOf = buf => {
  const out = {}
  for (let i = 0; i < buf.readUInt16BE(12); i++) {
    const o = 44 + i * 20
    const tag = buf.toString('ascii', o, o + 4)
    const off = buf.readUInt32BE(o + 4)
    const comp = buf.readUInt32BE(o + 8)
    const orig = buf.readUInt32BE(o + 12)
    const data = buf.subarray(off, off + comp)
    out[tag] = comp === orig ? data : zlib.inflateSync(data)
  }
  return out
}

const faceOf = file => {
  const t = tablesOf(fs.readFileSync(file))
  const upem = t.head.readUInt16BE(18)
  const longLoca = t.head.readInt16BE(50)
  const cmap = t.cmap
  let sub = null
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const p = 4 + i * 8
    if (cmap.readUInt16BE(p) === 3 && [0, 1].includes(cmap.readUInt16BE(p + 2)))
      sub = cmap.readUInt32BE(p + 4)
  }
  const segX2 = cmap.readUInt16BE(sub + 6)
  const segs = segX2 / 2
  const endO = sub + 14
  const startO = endO + segX2 + 2
  const deltaO = startO + segX2
  const rangeO = deltaO + segX2
  const glyphOf = cp => {
    for (let i = 0; i < segs; i++) {
      if (cp > cmap.readUInt16BE(endO + i * 2)) continue
      const start = cmap.readUInt16BE(startO + i * 2)
      if (cp < start) return 0
      const delta = cmap.readInt16BE(deltaO + i * 2)
      const range = cmap.readUInt16BE(rangeO + i * 2)
      if (range === 0) return (cp + delta) & 0xffff
      const g = cmap.readUInt16BE(rangeO + i * 2 + range + (cp - start) * 2)
      return g ? (g + delta) & 0xffff : 0
    }
    return 0
  }
  const locOf = g =>
    longLoca ? t.loca.readUInt32BE(g * 4) : t.loca.readUInt16BE(g * 2) * 2
  const boundsOf = cp => {
    const g = glyphOf(cp)
    const a = locOf(g)
    if (a === locOf(g + 1)) return null // a blank glyph draws no ink
    return {
      min: t.glyf.readInt16BE(a + 4) / upem,
      max: t.glyf.readInt16BE(a + 8) / upem,
    }
  }
  const spanOf = chars => {
    const seen = chars.map(c => boundsOf(c.codePointAt(0))).filter(Boolean)
    return {
      above: Math.max(...seen.map(b => b.max)),
      below: -Math.min(...seen.map(b => b.min)),
    }
  }
  const letters = []
  for (let cp = 0x30; cp <= 0x39; cp++) letters.push(String.fromCharCode(cp))
  for (let cp = 0x41; cp <= 0x5a; cp++) letters.push(String.fromCharCode(cp))
  for (let cp = 0x61; cp <= 0x7a; cp++) letters.push(String.fromCharCode(cp))
  return {
    ascender: t.hhea.readInt16BE(4) / upem,
    descender: -t.hhea.readInt16BE(6) / upem,
    text: spanOf(letters),
    caps: spanOf(letters.map(c => c.toUpperCase())),
  }
}

const round = n => Math.round(n * 1000) / 1000
for (const [family, weight, path] of FACES) {
  const url = new URL(`../node_modules/${path}`, import.meta.url)
  const f = faceOf(url)
  console.log(
    `${family} ${weight}: ascender ${round(f.ascender)} descender ${round(f.descender)} ` +
      `| text ${round(f.text.above)}/${round(f.text.below)} ` +
      `| caps ${round(f.caps.above)}/${round(f.caps.below)}`,
  )
}
