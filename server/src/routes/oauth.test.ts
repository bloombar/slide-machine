/**
 * Unit tests for the OAuth server's availability check (docs/MCP.md §5).
 *
 * Small, and the reason it exists is not: RFC 8414 requires an https issuer
 * and the SDK enforces it by throwing while the router is being built — inside
 * `createApp`. So a deployment reached over plain http would not lose agent
 * access, it would fail to start at all. This check is what turns an outage
 * back into a missing feature.
 */
import { describe, expect, it } from 'vitest'
import {
  isUsableIssuer,
  oauthAvailable,
  issuerOrigin,
  resourceUrl,
} from './oauth'

describe('isUsableIssuer', () => {
  it('accepts https, which is what the standard requires', () => {
    expect(isUsableIssuer('https://slides.example.edu')).toBe(true)
  })

  it('accepts localhost, so development works without certificates', () => {
    expect(isUsableIssuer('http://localhost:5173')).toBe(true)
    expect(isUsableIssuer('http://127.0.0.1:3000')).toBe(true)
  })

  it('refuses plain http elsewhere rather than letting the app crash', () => {
    expect(isUsableIssuer('http://slides.example.edu')).toBe(false)
  })

  it('refuses an origin that is not a URL at all', () => {
    expect(isUsableIssuer('not a url')).toBe(false)
    expect(isUsableIssuer('')).toBe(false)
  })
})

describe('the configured deployment', () => {
  it('can host the feature under the test environment’s own origin', () => {
    // The suite runs with PUBLIC_BASE_URL on localhost, so this is the
    // development answer — and it must stay true, or every OAuth integration
    // test would be exercising a router that was never mounted.
    expect(issuerOrigin()).toMatch(/localhost/)
    expect(oauthAvailable()).toBe(true)
  })

  it('advertises the MCP endpoint on that same origin', () => {
    expect(resourceUrl()).toBe(`${issuerOrigin()}/api/mcp`)
  })
})
