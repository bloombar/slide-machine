/**
 * Unit tests for the action-API client, driven by a stub fetch.
 */
import { describe, it, expect, vi } from 'vitest'
import { createClient, ApiError } from './client.mjs'

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

const loginOk = (token = 'tok-1') =>
  json(200, { accessToken: token, user: { displayName: 'Ada' } })

describe('createClient', () => {
  it('signs in and returns the account', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(loginOk())
    const client = await createClient({
      baseUrl: 'http://app.test/',
      email: 'a@b.c',
      password: 'pw',
      fetchImpl,
    })
    expect(client.user.displayName).toBe('Ada')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('http://app.test/api/auth/login')
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.c', password: 'pw' })
  })

  it('reports a failed sign-in as an ApiError', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        json(401, { error: { code: 'unauthorized', message: 'No.' } }),
      )
    await expect(
      createClient({
        baseUrl: 'http://app.test',
        email: 'a',
        password: 'b',
        fetchImpl,
      }),
    ).rejects.toThrow(ApiError)
  })
})

describe('act', () => {
  const build = async fetchImpl =>
    createClient({
      baseUrl: 'http://app.test',
      email: 'a@b.c',
      password: 'pw',
      fetchImpl,
      retries: 2,
    })

  it('posts to the named action with the bearer token', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(json(200, { id: 'p1' }))
    const client = await build(fetchImpl)
    await expect(client.act('project.create', { title: 'T' })).resolves.toEqual(
      {
        id: 'p1',
      },
    )
    const [url, init] = fetchImpl.mock.calls[1]
    expect(url).toBe('http://app.test/api/actions/project.create')
    expect(init.headers.Authorization).toBe('Bearer tok-1')
    expect(JSON.parse(init.body)).toEqual({ title: 'T' })
  })

  /**
   * An access token lasts fifteen minutes and a course import runs longer,
   * so an expiry in the middle of a run has to be recovered from rather
   * than losing every lecture after it.
   */
  it('signs in again when the token has expired, then retries the call', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(loginOk('tok-1'))
      .mockResolvedValueOnce(json(401, { error: { code: 'invalid_token' } }))
      .mockResolvedValueOnce(loginOk('tok-2'))
      .mockResolvedValueOnce(json(200, { ok: true }))
    const client = await build(fetchImpl)
    await expect(client.act('deck.create')).resolves.toEqual({ ok: true })
    expect(fetchImpl.mock.calls[3][1].headers.Authorization).toBe(
      'Bearer tok-2',
    )
  })

  it('gives up rather than looping when the fresh token is also refused', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValue(
        json(401, { error: { code: 'invalid_token', message: 'no' } }),
      )
    const client = await build(fetchImpl)
    await expect(client.act('deck.create')).rejects.toThrow(ApiError)
  })

  it('retries a rate limit and a server error', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(json(429, {}))
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(200, { done: true }))
    const client = await build(fetchImpl)
    const pending = client.act('slide.add')
    await vi.runAllTimersAsync()
    await expect(pending).resolves.toEqual({ done: true })
    vi.useRealTimers()
  })

  it('surfaces the server’s own error code for a rejected call', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(
        json(400, {
          error: {
            code: 'invalid_input',
            message: 'slots: bad',
            details: ['x'],
          },
        }),
      )
    const client = await build(fetchImpl)
    await expect(client.act('slide.editContent')).rejects.toMatchObject({
      status: 400,
      code: 'invalid_input',
      message: 'slots: bad',
      details: ['x'],
    })
  })

  it('does not retry a plain rejection', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(loginOk())
      .mockResolvedValueOnce(json(403, { error: { code: 'forbidden' } }))
    const client = await build(fetchImpl)
    await expect(client.act('deck.setStudyLabel')).rejects.toThrow()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('upload', () => {
  /** Seed material goes to the REST route, not through an action. */
  const setup = async responses => {
    const fetchImpl = vi.fn()
    fetchImpl.mockResolvedValueOnce(loginOk())
    for (const res of responses) fetchImpl.mockResolvedValueOnce(res)
    const client = await createClient({
      baseUrl: 'http://app.test',
      email: 'a@b.c',
      password: 'pw',
      fetchImpl,
    })
    return { client, fetchImpl }
  }

  it('posts the file as multipart form data with its fields', async () => {
    const { client, fetchImpl } = await setup([json(201, { id: 'sa-1' })])
    const asset = await client.upload({
      buffer: Buffer.from('png-bytes'),
      filename: 'waterfall.png',
      mime: 'image/png',
      fields: { projectId: 'p-1', deckId: 'd-1' },
    })
    expect(asset).toEqual({ id: 'sa-1' })

    const [url, init] = fetchImpl.mock.calls[1]
    expect(url).toBe('http://app.test/api/seed-assets')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer tok-1')
    // The boundary is FormData's to set; setting it by hand breaks the body.
    expect(init.headers['Content-Type']).toBeUndefined()
    expect(init.body.get('projectId')).toBe('p-1')
    expect(init.body.get('deckId')).toBe('d-1')
    expect(init.body.get('file').name).toBe('waterfall.png')
    expect(init.body.get('file').type).toBe('image/png')
  })

  it('omits a field that was not given', async () => {
    const { client, fetchImpl } = await setup([json(201, { id: 'sa-2' })])
    await client.upload({
      buffer: Buffer.from('x'),
      filename: 'a.pdf',
      mime: 'application/pdf',
      fields: { projectId: 'p-1', deckId: undefined },
    })
    expect(fetchImpl.mock.calls[1][1].body.has('deckId')).toBe(false)
  })

  /** An import runs past the fifteen-minute token life. */
  it('signs in again and retries once when the token has expired', async () => {
    const { client, fetchImpl } = await setup([
      json(401, { error: { code: 'invalid_token' } }),
      loginOk('tok-2'),
      json(201, { id: 'sa-3' }),
    ])
    const asset = await client.upload({
      buffer: Buffer.from('x'),
      filename: 'a.png',
      mime: 'image/png',
      fields: { projectId: 'p-1' },
    })
    expect(asset).toEqual({ id: 'sa-3' })
    expect(fetchImpl.mock.calls[3][1].headers.Authorization).toBe(
      'Bearer tok-2',
    )
  })

  it('reports a rejected format as an ApiError', async () => {
    const { client } = await setup([
      json(400, {
        error: { code: 'unsupported_type', message: 'Only PDF, DOCX, PNG…' },
      }),
    ])
    await expect(
      client.upload({
        buffer: Buffer.from('x'),
        filename: 'a.txt',
        mime: 'text/plain',
        fields: { projectId: 'p-1' },
      }),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'unsupported_type' })
  })
})
