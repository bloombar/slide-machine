/**
 * Provider registry (SPEC GEN-2/TECH-8). Adapters register themselves per
 * capability; the active adapter is resolved by name from server config,
 * so engines are swapped via configuration alone.
 *
 * No real adapters exist yet — each capability's configured default name
 * maps to an "unimplemented" stub that throws on use, proving the wiring
 * without pretending to work.
 */
import type { Capability } from '@slide-machine/shared'
import { env } from '../config/env'

type ProviderFactory = () => object

/** Maps each capability to the env var that selects its active adapter. */
export type ProviderSelectors = Record<Capability, string>

export const defaultSelectors: ProviderSelectors = {
  transcription: env.TRANSCRIPTION_PROVIDER,
  generation: env.GENERATION_PROVIDER,
  quizGeneration: env.QUIZ_PROVIDER,
  imageGeneration: env.IMAGE_GEN_PROVIDER,
}

/**
 * A placeholder provider whose every method throws. Registered under the
 * configured names until real adapters land, so resolution works end-to-end
 * and failures are descriptive rather than mysterious.
 */
export const unimplementedProvider = (
  capability: Capability,
  name: string,
): object =>
  new Proxy(
    { name },
    {
      get(target, prop) {
        if (prop in target) return target[prop as keyof typeof target]
        return () => {
          throw new Error(
            `Provider "${name}" for capability "${capability}" is not implemented yet`,
          )
        }
      },
    },
  )

export class ProviderRegistry {
  private factories = new Map<Capability, Map<string, ProviderFactory>>()
  private instances = new Map<Capability, object>()

  constructor(private selectors: ProviderSelectors) {}

  /** Registers an adapter factory for a capability under a config-selectable name. */
  register(
    capability: Capability,
    name: string,
    factory: ProviderFactory,
  ): void {
    if (!this.factories.has(capability))
      this.factories.set(capability, new Map())
    this.factories.get(capability)!.set(name, factory)
  }

  /** Resolves the active adapter for a capability from configuration (lazily instantiated). */
  get<T extends object>(capability: Capability): T {
    const cached = this.instances.get(capability)
    if (cached) return cached as T

    const activeName = this.selectors[capability]
    const factory = this.factories.get(capability)?.get(activeName)
    if (!factory) {
      const known =
        [...(this.factories.get(capability)?.keys() ?? [])].join(', ') || 'none'
      throw new Error(
        `No provider named "${activeName}" registered for capability "${capability}" (registered: ${known})`,
      )
    }
    const instance = factory()
    this.instances.set(capability, instance)
    return instance as T
  }
}

/** The application-wide registry, wired to server config. */
export const registry = new ProviderRegistry(defaultSelectors)

// Placeholder registrations — replaced capability-by-capability as real
// adapters (Google Cloud STT, Gemini, ...) are implemented.
for (const [capability, name] of Object.entries(defaultSelectors) as [
  Capability,
  string,
][]) {
  registry.register(capability, name, () =>
    unimplementedProvider(capability, name),
  )
}
