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
  // 24 kHz, not the 16 kHz the speech models want: the same recording is
  // played back per slide, and 16 kHz drops the sibilance that makes it sound
  // like speech rather than a phone call.
  it('defaults to 24 kHz — chosen for playback, not for the model', () => {
    expect(parseEnv({ ...base }).STT_CAPTURE_SAMPLE_RATE).toBe(24000)
  })

  it('accepts 0, the "no downsampling" setting', () => {
    const env = parseEnv({ ...base, STT_CAPTURE_SAMPLE_RATE: '0' })
    expect(env.STT_CAPTURE_SAMPLE_RATE).toBe(0)
  })

  it('accepts rates inside the supported band', () => {
    for (const rate of ['8000', '16000', '24000', '48000']) {
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

describe('parseEnv BILLING_PROVIDER production guard', () => {
  // P-8. The webhook route is unauthenticated by necessity — its caller is a
  // payment provider, not a user — so the signature is the only thing
  // distinguishing the provider from a stranger. The mock adapter verifies
  // nothing, which makes it a way to write a subscription row for any account
  // a POST names. A deployment in that state cannot serve the route safely,
  // so it does not start.
  it('refuses the unsigned mock adapter in production', () => {
    expect(() =>
      parseEnv({ ...base, NODE_ENV: 'production', BILLING_PROVIDER: 'mock' }),
    ).toThrow()
  })

  it('allows the mock adapter everywhere else', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(
        parseEnv({ ...base, NODE_ENV, BILLING_PROVIDER: 'mock' })
          .BILLING_PROVIDER,
      ).toBe('mock')
    }
  })

  it('allows a real adapter in production', () => {
    expect(
      parseEnv({ ...base, NODE_ENV: 'production', BILLING_PROVIDER: 'stripe' })
        .BILLING_PROVIDER,
    ).toBe('stripe')
  })

  it('lets a test harness say the dangerous thing out loud', () => {
    // The e2e suite runs the production *build* against mock billing, which
    // is a real "production plus mock" that is not a production deployment.
    // The way through is a variable named after exactly what it permits —
    // nobody sets this on a real deployment by accident.
    expect(
      parseEnv({
        ...base,
        NODE_ENV: 'production',
        BILLING_PROVIDER: 'mock',
        ALLOW_UNSIGNED_BILLING_WEBHOOKS: 'true',
      }).BILLING_PROVIDER,
    ).toBe('mock')
  })

  it('defaults the escape hatch to closed', () => {
    expect(parseEnv(base).ALLOW_UNSIGNED_BILLING_WEBHOOKS).toBe(false)
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
