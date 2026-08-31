/**
 * Unit tests for rendering a static document to HTML. What matters is that
 * the prose survives as readable markup and that nothing in a document can
 * inject markup of its own.
 */
import { describe, it, expect } from 'vitest'
import { privacyDocument, termsDocument } from '@slide-machine/shared'
import { documentToHtml } from './document-html'

const OPERATOR = {
  name: 'Teaching Ltd',
  jurisdiction: 'New York, USA',
  contactEmail: 'legal@example.com',
  postalAddress: '1 Road, City, 00000, USA',
}

describe('documentToHtml', () => {
  it('renders the title as the page’s only h1', () => {
    const html = documentToHtml(privacyDocument(OPERATOR))
    expect(html).toContain('<h1>Privacy policy</h1>')
    // The body's own top level is `##`, so nothing else claims h1
    expect(html.match(/<h1>/g)).toHaveLength(1)
  })

  it('carries the summary and the date', () => {
    const html = documentToHtml(privacyDocument(OPERATOR))
    expect(html).toContain('What the Slide Machine collects')
    expect(html).toContain('Last updated:')
  })

  it('turns the Markdown body into structured HTML', () => {
    const html = documentToHtml(privacyDocument(OPERATOR))
    expect(html).toContain('<h2>')
    expect(html).toContain('<p>')
    expect(html).toContain('<strong>')
    expect(html).toContain('<ul>')
  })

  it('names the operator it was given, everywhere the document does', () => {
    const html = documentToHtml(termsDocument(OPERATOR))
    expect(html).toContain('Teaching Ltd')
    expect(html).toContain('New York, USA')
    // Nothing fell back to a placeholder when a real value was supplied
    expect(html).not.toContain('[Operator legal name]')
  })

  it('states the disclosures Google’s privacy requirement asks about', () => {
    const html = documentToHtml(privacyDocument(OPERATOR))
    // What is collected, what is done with it, and how long it is kept
    expect(html).toMatch(/If you sign in with Google/)
    expect(html).toMatch(/drive|Drive/)
    expect(html).toMatch(/do not sell/)
  })

  it('escapes a title rather than letting it carry markup', () => {
    const html = documentToHtml({
      title: '<script>alert(1)</script>',
      summary: 'x " y',
      body: 'plain',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&quot;')
  })

  it('drops raw HTML in a body instead of passing it through', () => {
    const html = documentToHtml({
      title: 'T',
      summary: 'S',
      body: 'before <img src=x onerror=alert(1)> after',
    })
    expect(html).not.toContain('<img')
    expect(html).not.toContain('onerror')
  })

  it('keeps a link but not its other attributes', () => {
    const html = documentToHtml({
      title: 'T',
      summary: 'S',
      body: '[policy](/privacy)',
    })
    expect(html).toContain('href="/privacy"')
  })

  it('omits the date line for a document that has none', () => {
    const html = documentToHtml({ title: 'T', summary: 'S', body: 'x' })
    expect(html).not.toContain('Last updated:')
  })
})
