/**
 * Unit tests for the listen-result reporter. The behaviour that matters is the
 * failure path: Express 5 delivers bind errors to the success callback, so a
 * failed bind must never print the "listening" line and must exit non-zero.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { reportListen } from './listen'

/** Builds an errno-style error the way Node reports a failed bind. */
const bindError = (code: string): Error =>
  Object.assign(new Error(`listen ${code}`), { code })

let log: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>
let exit: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
  // Mocked so the failure path can be asserted without killing the test run.
  exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('reportListen on a successful bind', () => {
  it('announces the port and environment', () => {
    reportListen(undefined, 3000, 'development')
    expect(log).toHaveBeenCalledWith(
      'Slide Machine server listening on port 3000 (development)',
    )
  })

  it('does not exit or log an error', () => {
    reportListen(undefined, 3000, 'development')
    expect(error).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })

  /**
   * The proxy setting cannot be read from outside — the health endpoint
   * deliberately does not publish it — so the boot log is the only place an
   * operator can confirm it took effect. A deploy that silently ignored the
   * variable would otherwise look identical to one that applied it.
   */
  it('says how many proxy hops it trusts', () => {
    reportListen(undefined, 3000, 'production', 2)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('2 proxy hop(s)'))
  })

  it('warns plainly when it trusts none, since that is a shared budget', () => {
    reportListen(undefined, 3000, 'production', 0)
    const said = log.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(said).toContain('Trusting no proxy')
    expect(said).toContain('one shared budget')
  })

  // The default matters: a caller that forgets to pass it must not silently
  // claim a proxy is trusted when none is.
  it('trusts none when not told otherwise', () => {
    reportListen(undefined, 3000, 'development')
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('Trusting no proxy'),
    )
  })
})

describe('reportListen on a failed bind', () => {
  it('never claims to be listening', () => {
    reportListen(bindError('EADDRINUSE'), 3000, 'development')
    expect(log).not.toHaveBeenCalled()
  })

  it('exits non-zero so the failure stops the process', () => {
    reportListen(bindError('EADDRINUSE'), 3000, 'development')
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('names the occupied port and how to change it (EADDRINUSE)', () => {
    reportListen(bindError('EADDRINUSE'), 3000, 'development')
    const message = error.mock.calls[0][0] as string
    expect(message).toContain('port 3000 is already in use')
    expect(message).toContain('PORT in server/.env')
  })

  it('explains a privileged port (EACCES)', () => {
    reportListen(bindError('EACCES'), 80, 'production')
    const message = error.mock.calls[0][0] as string
    expect(message).toContain('no permission to bind port 80')
    expect(message).toContain('PORT in server/.env')
  })

  it('falls back to a generic message for an unrecognized code', () => {
    reportListen(bindError('EAFNOSUPPORT'), 3000, 'development')
    expect(error).toHaveBeenCalledWith(
      'Server failed to start: could not bind port 3000.',
    )
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('handles an error carrying no code at all', () => {
    reportListen(new Error('boom'), 3000, 'development')
    expect(error).toHaveBeenCalledWith(
      'Server failed to start: could not bind port 3000.',
    )
    expect(exit).toHaveBeenCalledWith(1)
  })
})
