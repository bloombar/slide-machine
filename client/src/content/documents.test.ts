/**
 * Tests for the static documents themselves. They are prose, so there is
 * little to assert about their wording — but there is plenty to assert about
 * the things that rot: a link to a page that no longer exists, a legal
 * document that forgot to say when it last changed, or an operator detail
 * that reached the page as a placeholder when the server had a real one.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { OperatorDetails } from '@slide-machine/shared'
import { ABOUT } from './about'
import { ASSISTANTS } from './assistants'
import { privacyDocument } from './privacy'
import { termsDocument } from './terms'
import * as runtimeConfig from '../runtime-config'
import {
  OPERATOR_PLACEHOLDER,
  draftNotice,
  hasPlaceholders,
  resolveOperator,
  type StaticDocument,
} from './document'

/** A deployment that has said who it is. */
const ACME: OperatorDetails = {
  name: 'Acme Teaching Ltd',
  jurisdiction: 'New York, USA',
  contactEmail: 'legal@acme.example',
  postalAddress: '1 Broadway, New York, NY 10004, USA',
}

const BLANK: OperatorDetails = {
  name: '',
  jurisdiction: '',
  contactEmail: '',
  postalAddress: '',
}

const documents: [string, StaticDocument][] = [
  ['about', ABOUT],
  ['assistants', ASSISTANTS],
  ['privacy', privacyDocument(ACME)],
  ['terms', termsDocument(ACME)],
]

/** Every route the app serves a static document (or the feedback form) at.
 * A document may link to these and to nothing else in-app. */
const ROUTES = ['/about', '/assistants', '/feedback', '/privacy', '/terms']

/** In-app link targets in a Markdown body: `[text](/path)`. */
const internalLinks = (body: string): string[] =>
  [...body.matchAll(/\]\((\/[^)\s]*)\)/g)].map(match => match[1]!)

afterEach(() => vi.restoreAllMocks())

describe.each(documents)('the %s document', (_name, doc) => {
  it('has a title, a summary and a body', () => {
    expect(doc.title.trim()).not.toBe('')
    expect(doc.summary.trim()).not.toBe('')
    expect(doc.body.length).toBeGreaterThan(500)
  })

  it('starts its body below the page heading', () => {
    // The page renders `title` as the only h1; a body that opened with one
    // would give the page two.
    expect(doc.body).not.toMatch(/^# /m)
  })

  it('links only to pages that exist', () => {
    for (const href of internalLinks(doc.body)) {
      expect(ROUTES, `${doc.title} links to ${href}`).toContain(href)
    }
  })
})

describe('resolveOperator', () => {
  it('takes what the deployment configured', () => {
    expect(resolveOperator(ACME)).toEqual(ACME)
  })

  it('falls back to the placeholders when nothing was configured', () => {
    expect(resolveOperator(BLANK)).toEqual(OPERATOR_PLACEHOLDER)
  })

  // Per field, not all or nothing: a deployment with a name but no settled
  // jurisdiction should show the one it has.
  it('fills in only the fields left blank', () => {
    const partial = resolveOperator({ ...BLANK, name: 'Acme Teaching Ltd' })
    expect(partial.name).toBe('Acme Teaching Ltd')
    expect(partial.jurisdiction).toBe(OPERATOR_PLACEHOLDER.jurisdiction)
  })

  it('treats whitespace as blank', () => {
    expect(resolveOperator({ ...BLANK, name: '   ' }).name).toBe(
      OPERATOR_PLACEHOLDER.name,
    )
  })

  // The pages call it with no argument, so this is the path that actually
  // runs in the app.
  it('reads the server’s answer by default', () => {
    vi.spyOn(runtimeConfig, 'getOperator').mockReturnValue(ACME)
    expect(resolveOperator()).toEqual(ACME)
  })
})

describe('the draft notice', () => {
  it('explains the square brackets while there are still some', () => {
    expect(draftNotice(resolveOperator(BLANK))).toContain('square brackets')
  })

  // Once every detail is real there are no brackets left to explain, but the
  // text has still not been through a lawyer.
  it('keeps the pending-review line once the details are filled in', () => {
    const notice = draftNotice(ACME)
    expect(notice).toContain('pending legal review')
    expect(notice).not.toContain('square brackets')
  })

  it('knows when a detail is still a placeholder', () => {
    expect(hasPlaceholders(resolveOperator(BLANK))).toBe(true)
    expect(hasPlaceholders(ACME)).toBe(false)
  })
})

describe('the legal documents', () => {
  const legal: [string, (operator: OperatorDetails) => StaticDocument][] = [
    ['privacy', privacyDocument],
    ['terms', termsDocument],
  ]

  it.each(legal)('%s says when it last changed', (_name, build) => {
    expect(build(ACME).updated).toBeTruthy()
  })

  it.each(legal)('%s carries the draft notice', (_name, build) => {
    expect(build(ACME).body).toMatch(/^> \*\*Draft\.\*\*/m)
  })

  it.each(legal)('%s names the configured operator', (_name, build) => {
    const body = build(ACME).body
    expect(body).toContain(ACME.name)
    expect(body).toContain(ACME.contactEmail)
    expect(body).toContain(ACME.postalAddress)
    // Nothing of the unconfigured version survives
    expect(body).not.toContain(OPERATOR_PLACEHOLDER.name)
  })

  it.each(legal)('%s shows placeholders when unconfigured', (_name, build) => {
    expect(build(resolveOperator(BLANK)).body).toContain(
      OPERATOR_PLACEHOLDER.name,
    )
  })

  // Only the terms turn on where the operator is; the policy does not, so
  // asserting it there would pin a sentence that is not in it.
  it('names the jurisdiction in the terms', () => {
    expect(termsDocument(ACME).body).toContain(ACME.jurisdiction)
  })
})

// About is the one document with no legal weight, so it is the one that
// should be pointing people at the others.
describe('the about document', () => {
  it('points at the privacy policy and the feedback form', () => {
    expect(internalLinks(ABOUT.body)).toEqual(
      expect.arrayContaining(['/privacy', '/feedback']),
    )
  })

  it('has no date to go stale', () => {
    expect(ABOUT.updated).toBeUndefined()
  })
})
