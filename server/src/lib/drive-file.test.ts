/**
 * Unit tests for reading a template file out of a connected Drive (EXP-3/EXP-4).
 *
 * Two things matter here. The id has to come out of whatever the instructor
 * pasted, because they paste a link and not an id. And a read that goes wrong
 * has to say which kind of wrong it is: a missing grant is a step the user can
 * take, a missing file is not, and telling them apart is the difference
 * between an actionable message and a shrug.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  driveFileIdFrom,
  readDriveFileTextLive,
  DriveFileUnreadableError,
} from './drive-file'

afterEach(() => vi.unstubAllGlobals())

/** A Drive response with the given status and body. */
const respond = (status: number, body = '', headers: HeadersInit = {}) =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(body, { status, headers })),
  )

describe('the link an instructor pastes', () => {
  it('is read out of a Drive file URL', () => {
    expect(
      driveFileIdFrom('https://drive.google.com/file/d/1AbC_dEf-123/view'),
    ).toBe('1AbC_dEf-123')
  })

  it('is read out of a link that carries it as a parameter', () => {
    expect(driveFileIdFrom('https://drive.google.com/open?id=1AbC_dEf')).toBe(
      '1AbC_dEf',
    )
  })

  it('is taken as-is when they pasted the bare id', () => {
    expect(driveFileIdFrom('1AbCdEfGhIjKl')).toBe('1AbCdEfGhIjKl')
  })

  it('is nothing when they pasted something else', () => {
    // Better a clear complaint than a confusing 404 from Google
    expect(driveFileIdFrom('my template file')).toBeNull()
    expect(driveFileIdFrom('')).toBeNull()
    expect(driveFileIdFrom('   ')).toBeNull()
  })

  it('ignores surrounding whitespace, which a paste often brings', () => {
    expect(driveFileIdFrom('  1AbCdEfGhIjKl \n')).toBe('1AbCdEfGhIjKl')
  })
})

describe('reading the file', () => {
  it('asks Drive for the bytes, not the metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('kind: template'))
    vi.stubGlobal('fetch', fetchMock)
    await readDriveFileTextLive('token-1', 'file-1')
    const [url, init] = fetchMock.mock.calls[0]!
    // alt=media is what makes it the contents rather than a description of them
    expect(url).toContain('alt=media')
    expect(url).toContain('file-1')
    expect(init.headers.Authorization).toBe('Bearer token-1')
  })

  it('hands back exactly what the file says', async () => {
    respond(200, 'version: 1\nkind: template\n')
    await expect(readDriveFileTextLive('t', 'f')).resolves.toBe(
      'version: 1\nkind: template\n',
    )
  })

  it('says a refused read is worth reconnecting for when the grant is short', async () => {
    // A missing scope is a step the instructor can take, not a dead end
    respond(403, '{"error":{"errors":[{"reason":"insufficientPermissions"}]}}')
    await expect(readDriveFileTextLive('t', 'f')).rejects.toMatchObject({
      name: 'DriveFileUnreadableError',
      reconnect: true,
    })
  })

  it('does not, when the file is simply not the account’s to open', async () => {
    // The common case: a pasted link to somebody else's file. Nothing is
    // wrong with the connection, so reconnecting sends the instructor through
    // the consent screen to arrive back at exactly the same refusal.
    respond(
      403,
      '{"error":{"errors":[{"reason":"forbidden"}],"message":"The user does not have sufficient permissions for this file"}}',
    )
    const err = await readDriveFileTextLive('t', 'f').catch(e => e)
    expect(err.forbidden).toBe(true)
    expect(err.reconnect).toBe(false)
  })

  it('asks for a reconnect when the token itself has gone stale', async () => {
    respond(401, '{"error":{"message":"Invalid Credentials"}}')
    const err = await readDriveFileTextLive('t', 'f').catch(e => e)
    expect(err.reconnect).toBe(true)
  })

  it('says a missing file is not', async () => {
    respond(404)
    const err = await readDriveFileTextLive('t', 'f').catch(e => e)
    expect(err).toBeInstanceOf(DriveFileUnreadableError)
    expect(err.reconnect).toBe(false)
  })

  it('reports any other failure without pretending to know why', async () => {
    respond(500)
    await expect(readDriveFileTextLive('t', 'f')).rejects.toThrow(/500/)
  })

  it('refuses a file too large to be a template, by its declared size', async () => {
    respond(200, 'x', { 'content-length': String(9 * 1024 * 1024) })
    await expect(readDriveFileTextLive('t', 'f')).rejects.toThrow(/too large/)
  })

  it('refuses one too large by measurement, which a chunked reply hides', async () => {
    // No content-length at all, so trusting the header would let it through
    respond(200, 'x'.repeat(3 * 1024 * 1024))
    await expect(readDriveFileTextLive('t', 'f')).rejects.toThrow(/too large/)
  })
})
