/**
 * A small client for the app's action API.
 *
 * Everything the importer does goes through `POST /api/actions/:name` with a
 * bearer token, which is the same path the browser client uses — so an
 * imported lecture is created, authorized and validated exactly like one made
 * by hand.
 *
 * Access tokens last fifteen minutes and a course import runs longer than
 * that, so the client re-signs in on its own when one expires.
 *
 * Seed material is the one exception to the action API: uploads go to the
 * REST route `POST /api/seed-assets` as multipart form data, so `upload`
 * sits alongside `act` and shares its token and retry behaviour.
 */

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Errors the server will answer differently if simply asked again. */
const RETRYABLE = new Set([429, 500, 502, 503, 504])

/** An API call that failed, carrying the server's own error code. */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/**
 * Signs in and returns a client bound to that account.
 *
 * `baseUrl` is the app's origin (e.g. `http://localhost:3000`); the API is
 * always under `/api`.
 */
export const createClient = async ({
  baseUrl,
  email,
  password,
  retries = 4,
  fetchImpl = fetch,
}) => {
  const api = `${baseUrl.replace(/\/+$/, '')}/api`
  let token = null

  const login = async () => {
    const res = await fetchImpl(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new ApiError(
        res.status,
        body?.error?.code ?? 'login_failed',
        body?.error?.message ?? `Sign-in failed (${res.status})`,
      )
    }
    token = body.accessToken
    return body.user
  }

  const user = await login()

  /**
   * Dispatches one action. Retries transient failures with backoff, and
   * signs in again — once per call — when the token has expired.
   */
  const act = async (name, input = {}) => {
    let reauthorized = false
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${api}/actions/${name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      })
      if (res.ok) return res.json()

      const body = await res.json().catch(() => ({}))
      const code = body?.error?.code
      const message = body?.error?.message ?? `${name} failed (${res.status})`

      if (!reauthorized && (code === 'invalid_token' || res.status === 401)) {
        reauthorized = true
        await login()
        continue
      }
      if (RETRYABLE.has(res.status) && attempt < retries) {
        await sleep(Math.min(30_000, 1000 * 2 ** attempt))
        continue
      }
      throw new ApiError(res.status, code, message, body?.error?.details)
    }
  }

  /**
   * Uploads one seed-material file to `POST /api/seed-assets`.
   *
   * `fields` carries the multipart text fields the route reads —
   * `projectId`, and `deckId` for material attached to one lecture. The
   * body's content type is left to FormData so its boundary is set for us.
   */
  const upload = async ({ buffer, filename, mime, fields = {} }) => {
    let reauthorized = false
    for (let attempt = 0; ; attempt++) {
      const form = new FormData()
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) form.append(key, String(value))
      }
      form.append('file', new Blob([buffer], { type: mime }), filename)

      const res = await fetchImpl(`${api}/seed-assets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      if (res.ok) return res.json()

      const body = await res.json().catch(() => ({}))
      const code = body?.error?.code
      const message =
        body?.error?.message ?? `Upload of ${filename} failed (${res.status})`

      if (!reauthorized && (code === 'invalid_token' || res.status === 401)) {
        reauthorized = true
        await login()
        continue
      }
      if (RETRYABLE.has(res.status) && attempt < retries) {
        await sleep(Math.min(30_000, 1000 * 2 ** attempt))
        continue
      }
      throw new ApiError(res.status, code, message, body?.error?.details)
    }
  }

  return { act, upload, user, baseUrl: baseUrl.replace(/\/+$/, '') }
}
