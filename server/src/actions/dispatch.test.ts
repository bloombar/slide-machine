/**
 * Unit tests for the action dispatch pipeline (validate → authorize →
 * meter → execute) using the system.echo demo action.
 */
import { describe, it, expect } from 'vitest'
import {
  dispatch,
  ActionNotFoundError,
  ActionValidationError,
  registerAction,
} from './dispatch'
import { defineAction } from './define'
import { z } from 'zod'
import './system'

const ctx = { requestId: 'test-request' }

describe('dispatch', () => {
  it('executes a registered action with valid input', async () => {
    const result = await dispatch<{ message: string; requestId: string }>(
      'system.echo',
      { message: 'hello' },
      ctx,
    )
    expect(result).toEqual({ message: 'hello', requestId: 'test-request' })
  })

  it('rejects invalid input with a typed validation error', async () => {
    await expect(
      dispatch('system.echo', { message: 42 }, ctx),
    ).rejects.toBeInstanceOf(ActionValidationError)
  })

  it('rejects unknown action names', async () => {
    await expect(dispatch('nope.nothing', {}, ctx)).rejects.toBeInstanceOf(
      ActionNotFoundError,
    )
  })

  it('runs authorize and meter hooks before execute', async () => {
    const calls: string[] = []
    registerAction(
      defineAction({
        name: 'test.hooks',
        input: z.object({}),
        authorize: async () => {
          calls.push('authorize')
        },
        meter: async () => {
          calls.push('meter')
        },
        execute: async () => {
          calls.push('execute')
          return null
        },
      }),
    )
    await dispatch('test.hooks', {}, ctx)
    expect(calls).toEqual(['authorize', 'meter', 'execute'])
  })
})
