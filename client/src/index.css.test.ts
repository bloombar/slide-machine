/**
 * A rendering test cannot read a stylesheet's cascade in jsdom, so this
 * reads `index.css` as a source file (the same approach `index-html.test.ts`
 * takes for `index.html`).
 *
 * It proves the source *contains* a rule of the right shape — a font-size
 * floor of >= 16px for text-entry controls, gated to small viewports — not
 * that a browser applies it above any other rule. Whether the cascade
 * actually resolves that way (Tailwind's per-control utility classes still
 * winning where a component sets its own size) is not something a source
 * read can check; that is exercised visually, not by this test.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const css = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.css'),
  'utf8',
)

describe('index.css', () => {
  it('gives every text-entry control a >=16px floor on small viewports (AUTH-8)', () => {
    // A media query block, somewhere below 640px, whose selector list names
    // all three control elements and sets font-size to at least 16px.
    const mediaBlock = css.match(
      /@media[^{]*max-width:\s*(\d+)px[^{]*\{([\s\S]*?)\n {2}\}/,
    )
    expect(
      mediaBlock,
      'expected a max-width media query in index.css',
    ).not.toBeNull()

    const [, maxWidth, body] = mediaBlock!
    expect(Number(maxWidth)).toBeLessThanOrEqual(768)

    const rule = (body ?? '').match(
      /input\s*,\s*select\s*,\s*textarea\s*\{\s*font-size:\s*([\d.]+)px/,
    )
    expect(
      rule,
      'expected an input/select/textarea rule setting font-size in px',
    ).not.toBeNull()
    expect(Number(rule![1])).toBeGreaterThanOrEqual(16)
  })
})
