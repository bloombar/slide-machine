/**
 * Unit tests for environment parsing. parseEnv is exercised with explicit
 * sources so process.env stays untouched. Focus: PUBLIC_BASE_URL trailing-slash
 * normalization, so appending paths (e.g. /app) never yields a double slash.
 */
import { describe, it, expect } from 'vitest'
import { parseEnv } from './env'

// Minimal source satisfying the required fields, so parseEnv returns a value
// instead of exiting the process on validation failure.
const base = {
  MONGODB_URI: 'mongodb://localhost:27017/slide-machine',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
}

describe('parseEnv STT_CAPTURE_SAMPLE_RATE', () => {
  it('defaults to the 16 kHz Cloud STT models expect', () => {
    expect(parseEnv({ ...base }).STT_CAPTURE_SAMPLE_RATE).toBe(16000)
  })

  it('accepts 0, the "no downsampling" setting', () => {
    const env = parseEnv({ ...base, STT_CAPTURE_SAMPLE_RATE: '0' })
    expect(env.STT_CAPTURE_SAMPLE_RATE).toBe(0)
  })

  it('accepts rates inside the supported band', () => {
    for (const rate of ['8000', '16000', '48000']) {
      expect(
        parseEnv({ ...base, STT_CAPTURE_SAMPLE_RATE: rate })
          .STT_CAPTURE_SAMPLE_RATE,
      ).toBe(Number(rate))
    }
  })

  it('rejects a rate between 0 and the 8 kHz floor', () => {
    // 4000 would be silently unusable for speech; 0 is the only value below
    // the floor that means anything.
    expect(() =>
      parseEnv({ ...base, STT_CAPTURE_SAMPLE_RATE: '4000' }),
    ).toThrow()
  })

  it('rejects a rate above the 48 kHz ceiling', () => {
    expect(() =>
      parseEnv({ ...base, STT_CAPTURE_SAMPLE_RATE: '96000' }),
    ).toThrow()
  })
})

describe('parseEnv PUBLIC_BASE_URL normalization', () => {
  it('strips a trailing slash (DO ${_self.PUBLIC_URL} includes one)', () => {
    const env = parseEnv({
      ...base,
      PUBLIC_BASE_URL: 'https://slide-machine-7kin4.ondigitalocean.app/',
    })
    expect(env.PUBLIC_BASE_URL).toBe(
      'https://slide-machine-7kin4.ondigitalocean.app',
    )
  })

  it('strips repeated trailing slashes', () => {
    const env = parseEnv({ ...base, PUBLIC_BASE_URL: 'https://example.app///' })
    expect(env.PUBLIC_BASE_URL).toBe('https://example.app')
  })

  it('leaves a slashless origin unchanged', () => {
    const env = parseEnv({ ...base, PUBLIC_BASE_URL: 'https://example.app' })
    expect(env.PUBLIC_BASE_URL).toBe('https://example.app')
  })

  it('leaves PUBLIC_BASE_URL undefined when absent', () => {
    expect(parseEnv(base).PUBLIC_BASE_URL).toBeUndefined()
  })
})
