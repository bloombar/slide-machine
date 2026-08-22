/**
 * Unit tests for the link-preview rewrite that index.html is served through.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import request from 'supertest'
import { absolutizePreviewTags, serveSpa } from './static'

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
      `<html><head>${HEAD}</head></html>`,
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
