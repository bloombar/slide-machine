#!/usr/bin/env node
/**
 * Captures a Google Slides presentation using the account already connected
 * in the local database (TMPL-8).
 *
 * `capture-google-presentation.mjs` needs an access token pulled out of the
 * browser's devtools, which is a lot of steps to ask for when the answer to
 * "why did this deck import wrong" is in the deck. The app already stores a
 * refresh token for every connected account, so this mints an access token
 * from it and hands the presentation id to the same capture.
 *
 * Usage:
 *   node scripts/capture-with-connected-account.mjs <presentationIdOrUrl> [outFile]
 *
 * Reads `MONGODB_URI`, `GOOGLE_OAUTH_CLIENT_ID` and
 * `GOOGLE_OAUTH_CLIENT_SECRET` from `server/.env`. Nothing is sent anywhere:
 * it talks to Google and writes a file.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const [, , input, outFile] = process.argv
if (!input) {
  console.error(
    'Usage: node scripts/capture-with-connected-account.mjs <presentationIdOrUrl> [outFile]',
  )
  process.exit(1)
}

/** The id inside a Slides URL, or the id itself. */
const presentationId =
  /\/presentation\/d\/([a-zA-Z0-9_-]+)/.exec(input)?.[1] ?? input.trim()

/** `server/.env`, as a map. Not a full parser: `KEY=value`, `#` comments. */
const readEnv = () => {
  const out = {}
  for (const line of readFileSync(path.join('server', '.env'), 'utf8').split(
    '\n',
  )) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env = readEnv()
const need = name => {
  const value = process.env[name] ?? env[name]
  if (!value) {
    console.error(`Missing ${name} — set it in server/.env`)
    process.exit(1)
  }
  return value
}

/**
 * Every connected account's refresh token, with the address it belongs to.
 *
 * Every one, not the first: a token goes stale when the account is
 * disconnected or the grant is withdrawn, and a machine that has been used
 * for a while collects a few of those. Trying them in turn is the difference
 * between "this works" and "this reports invalid_grant and stops".
 *
 * Uses the `mongodb` driver the server already depends on, so this needs no
 * install of its own. The token field is `select: false` on the model, which
 * is a Mongoose rule — reading the collection directly sees it.
 */
const connectedAccounts = async () => {
  const uri = need('MONGODB_URI')
  const { MongoClient } = await import('mongodb')
  const client = new MongoClient(uri)
  try {
    await client.connect()
    const users = await client
      .db()
      .collection('users')
      .find(
        { googleQuizRefreshToken: { $exists: true, $ne: null } },
        { projection: { googleQuizRefreshToken: 1, email: 1 } },
      )
      .toArray()
    return users
      .filter(u => u.googleQuizRefreshToken)
      .map(u => ({ token: u.googleQuizRefreshToken, email: u.email }))
  } catch (e) {
    console.error(`Could not read the token from MongoDB: ${e.message}`)
    process.exit(1)
  } finally {
    await client.close().catch(() => {})
  }
}

/** An access token, minted from a stored refresh token, or nothing when that
 * token is no longer good. */
const accessToken = async refreshToken => {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: need('GOOGLE_OAUTH_CLIENT_ID'),
      client_secret: need('GOOGLE_OAUTH_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) return undefined
  return (await res.json()).access_token
}

/** The first connected account whose grant still works. */
const workingToken = async () => {
  const accounts = await connectedAccounts()
  if (!accounts.length) {
    console.error(
      'No connected Google account in the database. Connect one in the app first.',
    )
    process.exit(1)
  }
  for (const account of accounts) {
    const token = await accessToken(account.token)
    if (token) {
      console.log(
        `Using the account connected as ${account.email ?? 'unknown'}`,
      )
      return token
    }
    console.log(
      `  ${account.email ?? 'unknown'}: grant no longer valid, skipping`,
    )
  }
  console.error(
    "Every connected account's grant has expired. Reconnect Google in the app and run this again.",
  )
  process.exit(1)
}

/** Replaces short-lived signed image URLs so the capture does not rot. */
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

const token = await workingToken()
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
const destination =
  outFile ??
  path.join('server', 'test', 'fixtures', `presentation-${presentationId}.json`)
writeFileSync(destination, `${JSON.stringify(stabilizeUrls(raw), null, 2)}\n`)
console.log(
  `Wrote ${destination} — ${raw.slides?.length ?? 0} slides, ${raw.layouts?.length ?? 0} layouts, ${raw.masters?.length ?? 0} masters`,
)
