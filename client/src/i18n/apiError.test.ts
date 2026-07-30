/**
 * Unit tests for the two-tier API error message: a globally meaningful
 * code gets its own translation, and everything else falls back to the
 * call site's key rather than the server's English message.
 */
import { describe, it, expect } from 'vitest'
import { ApiError } from '../api/http'
import { apiErrorMessage } from './apiError'
import { i18n } from './index'

const t = i18n.t.bind(i18n)

describe('apiErrorMessage', () => {
  it('translates a globally meaningful code', () => {
    const err = new ApiError(401, 'invalid_credentials', 'Incorrect email')
    expect(apiErrorMessage(err, t, 'auth.errors.signIn')).toBe(
      'Incorrect email or password',
    )
  })

  it('uses the call site’s key for a code that means different things', () => {
    // `not_found` is thrown at a dozen sites; only the caller knows what
    // was not found.
    const err = new ApiError(404, 'not_found', 'Lecture not found')
    expect(apiErrorMessage(err, t, 'profile.errors.save')).toBe(
      'Could not save the profile.',
    )
  })

  it('never lets the server’s English message reach the screen', () => {
    const err = new ApiError(400, 'invalid_input', 'Display name is required')
    expect(apiErrorMessage(err, t, 'profile.errors.save')).not.toContain(
      'Display name',
    )
  })

  it('falls back for anything that is not an ApiError', () => {
    expect(
      apiErrorMessage(new TypeError('offline'), t, 'auth.errors.signIn'),
    ).toBe('Something went wrong — try again')
    expect(apiErrorMessage(undefined, t, 'auth.errors.signIn')).toBe(
      'Something went wrong — try again',
    )
  })
})
