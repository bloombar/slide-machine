/**
 * Provider registry (SPEC GEN-2/TECH-8). Adapters register themselves per
 * capability; the active adapter is resolved by name from server config,
 * so engines are swapped via configuration alone.
 *
 * Any capability whose configured name has no adapter registered under it
 * resolves to an "unimplemented" stub that throws a descriptive error on
 * use, so a missing or not-yet-built adapter surfaces clearly at the call
 * site instead of crashing at resolution.
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
  tts: env.TTS_PROVIDER,
}

/**
 * A placeholder provider whose every method throws. Registered under every
 * configured name as a fallback, so resolution works end-to-end and a name
 * with no real adapter fails descriptively rather than mysteriously.
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

// Seed every configured selector with a stub fallback. Real adapters
// register on import and overwrite the matching stub; any selector left
// unbacked still resolves — to a descriptive throw, not a missing-provider
// crash.
for (const [capability, name] of Object.entries(defaultSelectors) as [
  Capability,
  string,
][]) {
  registry.register(capability, name, () =>
    unimplementedProvider(capability, name),
  )
}
