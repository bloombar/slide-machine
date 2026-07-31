/**
 * Billing-provider registry (SPEC TECH-9). Mirrors the AI provider registry
 * (TECH-8) with a single capability: adapters register themselves by name and
 * the active one is resolved from `BILLING_PROVIDER` (TECH-4), so switching
 * vendors is a configuration change plus a data backfill.
 */
import type { BillingProvider } from '@slide-machine/shared'
import { env } from '../config/env'

type BillingProviderFactory = () => BillingProvider

export class BillingRegistry {
  private factories = new Map<string, BillingProviderFactory>()
  private instance?: BillingProvider

  constructor(private activeName: string) {}

  /** Registers an adapter factory under a config-selectable name. */
  register(name: string, factory: BillingProviderFactory): void {
    this.factories.set(name, factory)
  }

  /** Resolves the configured adapter, instantiating it once, lazily. */
  get(): BillingProvider {
    if (this.instance) return this.instance

    const factory = this.factories.get(this.activeName)
    if (!factory) {
      const known = [...this.factories.keys()].join(', ') || 'none'
      throw new Error(
        `No billing provider named "${this.activeName}" is registered (registered: ${known})`,
      )
    }
    this.instance = factory()
    return this.instance
  }
}

/** The application-wide billing registry, wired to server config. */
export const billingRegistry = new BillingRegistry(env.BILLING_PROVIDER)
