/**
 * Unit tests for the action dispatch pipeline (validate → authorize →
 * meter → execute) using the system.echo demo action.
 */
import { describe, it, expect } from 'vitest'
import {
  dispatch,
  runAction,
  ActionForbiddenError,
  ActionNotFoundError,
  ActionValidationError,
  registerAction,
} from './dispatch'
import { defineAction } from './define'
import { definePolicy } from './access/policy'
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

  it('runs the access policy and meter hook before execute', async () => {
    const calls: string[] = []
    registerAction(
      defineAction({
        name: 'test.hooks',
        input: z.object({}),
        access: definePolicy({ resource: 'none', level: 'open' }, async () => {
          calls.push('access')
          return undefined
        }),
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
    expect(calls).toEqual(['access', 'meter', 'execute'])
  })

  // The ordering TECH-14 exists to fix. With the check inside execute, an
  // exhausted plan answered before the ACL did — so someone with no rights to
  // a lecture was told about billing instead of being refused.
  it('authorizes before it meters', async () => {
    const calls: string[] = []
    registerAction(
      defineAction({
        name: 'test.hooks',
        input: z.object({}),
        access: definePolicy({ resource: 'none', level: 'open' }, async () => {
          calls.push('access')
          throw new ActionForbiddenError()
        }),
        meter: async () => {
          calls.push('meter')
        },
        execute: async () => {
          calls.push('execute')
          return null
        },
      }),
    )
    await expect(dispatch('test.hooks', {}, ctx)).rejects.toBeInstanceOf(
      ActionForbiddenError,
    )
    expect(calls).toEqual(['access'])
  })

  it('hands what the policy resolved to execute', async () => {
    registerAction(
      defineAction({
        name: 'test.hooks',
        input: z.object({}),
        access: definePolicy({ resource: 'none', level: 'open' }, async () => ({
          resolved: 'the loaded document',
        })),
        execute: async (_ctx, _input, access) => access.resolved,
      }),
    )
    expect(await dispatch('test.hooks', {}, ctx)).toBe('the loaded document')
  })

  it('runs an action from a typed reference, and can skip metering', async () => {
    const calls: string[] = []
    const action = defineAction({
      name: 'test.direct',
      input: z.object({ value: z.string() }),
      meter: async () => {
        calls.push('meter')
      },
      execute: async (_ctx, input) => input.value,
    })
    expect(await runAction(action, ctx, { value: 'ok' })).toBe('ok')
    expect(calls).toEqual(['meter'])

    expect(
      await runAction(action, ctx, { value: 'ok' }, { meter: false }),
    ).toBe('ok')
    expect(calls).toEqual(['meter'])
  })

  it('validates input the same way when run from a reference', async () => {
    const action = defineAction({
      name: 'test.direct',
      input: z.object({ value: z.string() }),
      execute: async (_ctx, input) => input.value,
    })
    await expect(
      runAction(action, ctx, { value: 42 } as never),
    ).rejects.toBeInstanceOf(ActionValidationError)
  })
})
