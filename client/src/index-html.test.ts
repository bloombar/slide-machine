/**
 * The served HTML has to stand on its own (AUTH-7).
 *
 * The app is client-rendered: without the <noscript> fallback in index.html,
 * anything that fetches the page without executing the bundle gets an empty
 * <div id="root"> — no description of the product, no statement of what user
 * data it asks for, no privacy link. Those are exactly the three things
 * Google's OAuth homepage requirements turn on, and the reason a first
 * verification attempt was rejected.
 *
 * So this reads index.html as a file, not as a rendered page. A test that
 * mounted the app would prove nothing: React is precisely what the reader we
 * are worried about does not run.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const html = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'),
  'utf8',
)

/** Just the fallback, so a match cannot be satisfied by a meta tag or a
 * comment elsewhere in the file. Whitespace is collapsed: the prose is
 * wrapped by Prettier, and a sentence is no less present for being broken
 * across two lines. */
const noscript = html
  .slice(html.indexOf('<noscript>'), html.indexOf('</noscript>'))
  .replace(/\s+/g, ' ')

describe('index.html', () => {
  it('carries a noscript fallback at all', () => {
    expect(html).toContain('<noscript>')
    expect(noscript.length).toBeGreaterThan(0)
  })

  it('identifies the app by the name the OAuth console must also use', () => {
    expect(noscript).toContain('The Slide Machine')
    // The "V2" suffix was the first requirement failing: a homepage whose
    // name disagrees with the consent screen's does not identify the brand
    expect(noscript).not.toContain('The Slide Machine V2')
  })

  it('describes what the app does', () => {
    expect(noscript).toMatch(/builds your lecture slides live/i)
    expect(noscript).toMatch(/transcribed/i)
  })

  it('states each kind of user data it asks for', () => {
    for (const disclosure of [
      'Your account',
      'Google sign-in',
      'Connecting Google Drive',
      'Your microphone',
    ]) {
      expect(noscript).toContain(disclosure)
    }
  })

  it('names the drive.file scope and its limits', () => {
    expect(noscript).toContain('drive.file')
    expect(noscript).toContain('cannot list, search or read the rest of your')
  })

  it('links the privacy policy and the terms', () => {
    expect(noscript).toContain('href="/privacy"')
    expect(noscript).toContain('href="/terms"')
  })
})
