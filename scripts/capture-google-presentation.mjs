#!/usr/bin/env node
/**
 * Captures a real Google Slides presentation as an import test fixture
 * (TMPL-8).
 *
 * The import bugs that reached users all came from real presentations, and
 * none came from a hand-written fixture: a fixture only contains the shapes
 * whoever wrote it already knew about. This writes the raw
 * `presentations.get` response to disk so a real deck can be the input to the
 * test suite.
 *
 * Usage:
 *   node scripts/capture-google-presentation.mjs <presentationId> [outFile]
 *
 * Needs a Google OAuth access token with `drive.readonly` (or
 * `presentations.readonly`) in GOOGLE_ACCESS_TOKEN. The app already asks for
 * that scope, so a token from a connected account works — the browser
 * devtools network tab on a template import is the quickest way to one.
 *
 * The response is written verbatim apart from the image URLs, which Google
 * signs and expires within the hour: keeping them would make the fixture rot
 * and, worse, quietly stop covering the picture path when it did. They are
 * rewritten to a stable placeholder host instead.
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'

const [, , presentationId, outFile] = process.argv
const token = process.env.GOOGLE_ACCESS_TOKEN

if (!presentationId || !token) {
  console.error(
    'Usage: GOOGLE_ACCESS_TOKEN=... node scripts/capture-google-presentation.mjs <presentationId> [outFile]',
  )
  process.exit(1)
}

const destination =
  outFile ??
  path.join('server', 'test', 'fixtures', `presentation-${presentationId}.json`)

/** Replaces short-lived signed image URLs so the fixture does not rot. */
const stabilizeUrls = (value, seen = { n: 0 }) => {
  if (Array.isArray(value)) return value.map(v => stabilizeUrls(v, seen))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        key === 'contentUrl' && typeof v === 'string'
          ? `https://fixture.invalid/image-${++seen.n}.png`
          : stabilizeUrls(v, seen),
      ]),
    )
  }
  return value
}

const res = await fetch(
  `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}`,
  { headers: { Authorization: `Bearer ${token}` } },
)

if (!res.ok) {
  console.error(
    `Google Slides read failed (${res.status}): ${await res.text()}`,
  )
  process.exit(1)
}

const raw = await res.json()
writeFileSync(destination, `${JSON.stringify(stabilizeUrls(raw), null, 2)}\n`)
console.log(
  `Wrote ${destination} — ${raw.slides?.length ?? 0} slides, ${
    raw.layouts?.length ?? 0
  } layouts, ${raw.masters?.length ?? 0} masters`,
)
console.log(
  'Point server/src/import/real-presentation.test.ts at it to run the pipeline against a real deck.',
)
