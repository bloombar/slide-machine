/**
 * Unit tests for the two rewrites index.html is served through: the
 * link-preview tags, and the noscript block the legal documents are inlined
 * into.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import { env } from './config/env'
import { absolutizePreviewTags, inlineDocument, serveSpa } from './static'

/** Stands in for the app summary index.html really ships. */
const NOSCRIPT = '<noscript><p>APP SUMMARY</p></noscript>'

const HEAD = [
  '<meta property="og:url" content="/" />',
  '<meta property="og:image" content="/og-image.png" />',
  '<meta property="og:image:width" content="1200" />',
  '<link rel="icon" href="/favicon.ico" sizes="32x32" />',
].join('\n')

describe('absolutizePreviewTags', () => {
  it('makes the preview image absolute', () => {
    // A relative og:image is dropped by scrapers, so the share loses its
    // picture entirely — the whole reason this rewrite exists.
    const out = absolutizePreviewTags(HEAD, 'https://slides.example', '/')
    expect(out).toContain(
      '<meta property="og:image" content="https://slides.example/og-image.png" />',
    )
  })

  it('points og:url at the page actually being shared', () => {
    const out = absolutizePreviewTags(
      HEAD,
      'https://slides.example',
      '/decks/42',
    )
    expect(out).toContain(
      '<meta property="og:url" content="https://slides.example/decks/42" />',
    )
  })

  it('tolerates a trailing slash on the configured origin', () => {
    const out = absolutizePreviewTags(HEAD, 'https://slides.example/', '/')
    expect(out).toContain('content="https://slides.example/og-image.png"')
    expect(out).not.toContain('example//')
  })

  it('leaves everything else alone', () => {
    const out = absolutizePreviewTags(HEAD, 'https://slides.example', '/')
    // Icons stay relative: the browser resolves those itself, and rewriting
    // them would pin a cached page to one hostname.
    expect(out).toContain(
      '<link rel="icon" href="/favicon.ico" sizes="32x32" />',
    )
    expect(out).toContain('<meta property="og:image:width" content="1200" />')
  })

  it('leaves an already-absolute tag untouched', () => {
    const absolute =
      '<meta property="og:image" content="https://cdn.example/x.png" />'
    expect(absolutizePreviewTags(absolute, 'https://slides.example', '/')).toBe(
      absolute,
    )
  })
})

describe('serveSpa', () => {
  let dist: string

  beforeAll(() => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-'))
    fs.writeFileSync(
      path.join(dist, 'index.html'),
      `<html><head>${HEAD}</head><body><div id="root"></div>${NOSCRIPT}</body></html>`,
    )
    fs.writeFileSync(path.join(dist, 'og-image.png'), 'not really a png')
  })

  afterAll(() => {
    fs.rmSync(dist, { recursive: true, force: true })
  })

  const app = (): express.Express => {
    const a = express()
    serveSpa(a, dist)
    return a
  }

  it('rewrites the preview tags on the root document', async () => {
    // "/" used to be served straight off disk by express.static, which is
    // exactly the page that gets shared — so it has to go through the
    // fallback like every other route.
    const res = await request(app()).get('/')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.text).toMatch(/content="http:\/\/[^"]+\/og-image\.png"/)
  })

  it('rewrites them on a deep link too, pointing og:url at that page', async () => {
    const res = await request(app()).get('/decks/42')
    expect(res.text).toMatch(
      /property="og:url" content="http:\/\/[^"]+\/decks\/42"/,
    )
  })

  it('still serves static files themselves', async () => {
    const res = await request(app()).get('/og-image.png')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('image/png')
    expect(res.body.toString()).toBe('not really a png')
  })

  it('leaves /api to the API', async () => {
    const res = await request(app()).get('/api/health')
    expect(res.status).toBe(404)
  })
})

describe('inlineDocument', () => {
  const page = `<body>${NOSCRIPT}</body>`

  it('replaces the app summary with the policy on /privacy', () => {
    const out = inlineDocument(page, '/privacy')
    expect(out).toContain('<h1>Privacy policy</h1>')
    // The generic summary is gone, not appended to
    expect(out).not.toContain('APP SUMMARY')
    // Still exactly one noscript block
    expect(out.match(/<noscript>/g)).toHaveLength(1)
  })

  it('serves the terms on /terms', () => {
    const out = inlineDocument(page, '/terms')
    expect(out).toContain('<h1>Terms &amp; conditions</h1>')
  })

  it('leaves the summary alone on every other path', () => {
    for (const path of ['/', '/about', '/login', '/d/some-deck']) {
      const out = inlineDocument(page, path)
      expect(out, path).toContain('APP SUMMARY')
      expect(out, path).not.toContain('<h1>Privacy policy</h1>')
    }
  })

  it('ignores a trailing slash', () => {
    expect(inlineDocument(page, '/privacy/')).toContain(
      '<h1>Privacy policy</h1>',
    )
  })

  it('returns a page with no noscript block untouched', () => {
    const bare = '<body><div id="root"></div></body>'
    expect(inlineDocument(bare, '/privacy')).toBe(bare)
  })

  it('names whoever this deployment configured, or the placeholder', () => {
    // Written against env rather than a literal, because the value differs
    // between a developer's .env and a CI run that sets nothing — and both
    // are correct. What is being pinned is that the render reads env at all.
    const out = inlineDocument(page, '/privacy')
    expect(out).toContain(env.OPERATOR_NAME || '[Operator legal name]')
    expect(out).toContain(env.OPERATOR_CONTACT_EMAIL || '[legal@example.com]')
  })
})

describe('serveSpa document inlining', () => {
  let dist: string

  beforeAll(() => {
    dist = fs.mkdtempSync(path.join(os.tmpdir(), 'spa-doc-'))
    fs.writeFileSync(
      path.join(dist, 'index.html'),
      `<html><head>${HEAD}</head><body><div id="root"></div>${NOSCRIPT}</body></html>`,
    )
  })

  afterAll(() => {
    fs.rmSync(dist, { recursive: true, force: true })
  })

  // The whole point: a reader that never executes the bundle still gets the
  // policy itself, in the response body, not a link to it.
  it('serves the policy in the body of /privacy', async () => {
    const a = express()
    serveSpa(a, dist)
    const res = await request(a).get('/privacy')
    expect(res.status).toBe(200)
    expect(res.text).toContain('<h1>Privacy policy</h1>')
    expect(res.text).toContain('<h2>')
    // And the preview rewrite still ran on the same response
    expect(res.text).toMatch(
      /property="og:url" content="http:\/\/[^"]+\/privacy"/,
    )
  })

  it('leaves the app summary on the home page', async () => {
    const a = express()
    serveSpa(a, dist)
    const res = await request(a).get('/')
    expect(res.text).toContain('APP SUMMARY')
  })
})
