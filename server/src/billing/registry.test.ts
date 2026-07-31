/**
 * Unit tests for the billing registry: config-driven resolution, single
 * instantiation, and the descriptive error when the configured name has no
 * adapter behind it.
 */
import { describe, it, expect, vi } from 'vitest'
import type { BillingProvider } from '@slide-machine/shared'
import { BillingRegistry } from './registry'

const stubProvider = (name: string): BillingProvider =>
  ({ name }) as BillingProvider

describe('BillingRegistry', () => {
  it('resolves the adapter selected by configuration', () => {
    const registry = new BillingRegistry('stripe')
    const stripe = stubProvider('stripe')
    registry.register('mock', () => stubProvider('mock'))
    registry.register('stripe', () => stripe)

    expect(registry.get()).toBe(stripe)
  })

  it('instantiates the adapter once and caches it', () => {
    const registry = new BillingRegistry('mock')
    const factory = vi.fn(() => stubProvider('mock'))
    registry.register('mock', factory)

    expect(registry.get()).toBe(registry.get())
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('names the configured and registered adapters when none matches', () => {
    const registry = new BillingRegistry('paddle')
    registry.register('stripe', () => stubProvider('stripe'))

    expect(() => registry.get()).toThrowError(/paddle.*stripe/s)
  })

  it('reports "none" when no adapter is registered at all', () => {
    expect(() => new BillingRegistry('stripe').get()).toThrowError(/none/)
  })
})
