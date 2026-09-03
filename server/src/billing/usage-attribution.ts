/**
 * Ambient attribution for metered work (SPEC BILL-3/BILL-7): who pays, who
 * acted, and what the work belonged to.
 *
 * The provider adapters are where the real numbers are — Gemini reports token
 * counts, the STT stream knows its own duration — but they are deliberately
 * ignorant of users: `GenerationProvider.generateSlideContent` takes a prompt,
 * not an account. Threading a payer through every provider interface would put
 * billing concepts inside the vendor seam that TECH-8 exists to keep clean.
 *
 * So the attribution rides along out-of-band: whoever knows it (an action
 * dispatch, a WebSocket session, a viewer's playback request) runs the work
 * inside `runWithUsage`, and any depth of the call stack can meter against it.
 *
 * This file holds only the store, with no imports of its own, so the counters
 * (`usage.ts`) and the cost ledger (`cost-ledger.ts`) can both read it without
 * either importing the other.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
// Type-only, so it erases at compile and this file still pulls in no
// project code at runtime — which is what keeps the counters and the cost
// ledger able to share it without importing each other.
import type { ActorChannel, Locale } from '@slide-machine/shared'

/**
 * What is known about a piece of metered work at the moment it happens.
 *
 * Everything but `userId` is optional because not every path knows it, and
 * a missing reference is better than a guessed one: BILL-7 records the project
 * and lecture **when the event occurs** precisely because they cannot be
 * reconstructed afterwards — a lecture's owner is not always its project's
 * owner, and either entity may be gone by the time anyone reads the ledger.
 */
export interface UsageAttribution {
  /** Who pays. For audience work this is the deck's owner, not the viewer. */
  userId: string
  /**
   * That a **viewer** caused this, rather than the account paying for it.
   *
   * Explicit rather than inferred from whether `actorId` differs from
   * `userId`, because the interesting case is the one where there is no
   * `actorId` at all: an anonymous student playing a shared lecture is
   * audience activity, and "nobody named" must not be read as "the owner did
   * it". Every path that serves a viewer knows it is doing so; none of them
   * has to know who the viewer is.
   */
  audience?: boolean
  /**
   * Who caused it, when they are identifiable. Absent for an anonymous
   * viewer — and deliberately not replaced with a tracking identity to make
   * them countable, which would trade a reporting convenience for what §16
   * promises. Those are counted as events instead.
   */
  actorId?: string
  /**
   * How the request that caused this work reached the app (docs/MCP.md §6).
   *
   * Orthogonal to `audience` and to `actorId`: those say *who*, this says
   * *through what*. An assistant editing its owner's lecture is the owner
   * acting, through an agent — and the second half is the part that cannot be
   * worked out later, because an agent's calls are deliberately ordinary calls
   * by the account that authorized them.
   */
  channel?: ActorChannel
  /**
   * The language the work was *for* — the language a viewer read the lecture
   * in, or heard it spoken in (SHARE-2, PLAY-3).
   *
   * Recorded because it cannot be recovered afterwards. `SlideTranslation`
   * knows which languages a lecture exists in, and the ledger knows who read
   * it and how often, but neither can say **which** language any one reading
   * was — and in a class where the first viewer of each language pays and
   * everyone behind them is a cache hit, almost every row is a cache hit. So
   * "how many students read this in Mandarin" has no answer unless the row
   * carries the language itself.
   *
   * Absent when the work has no language: generating a lecture, extracting
   * seed material, importing a file. A row without one means "not a
   * language-specific piece of work", never "English".
   */
  locale?: Locale
  /** The project the work belonged to, and its name at the time. */
  projectId?: string
  projectName?: string
  /** The lecture the work belonged to, and its title at the time. */
  deckId?: string
  deckName?: string
}

const storage = new AsyncLocalStorage<UsageAttribution>()

/** Runs `fn` with usage attributed to a payer, or to a fuller description of
 * who and what the work is for. */
export const runWithUsage = <T>(
  attribution: string | UsageAttribution,
  fn: () => Promise<T>,
): Promise<T> =>
  storage.run(
    typeof attribution === 'string' ? { userId: attribution } : attribution,
    fn,
  )

/**
 * Runs `fn` with no one to attribute usage to, even inside a context that has
 * one.
 *
 * For work the app does for its own chrome rather than for a lecture: the
 * placeholder pictures in the template editor's preview are the case this
 * exists for. They go through the same image search a real slide does, and
 * that search meters itself — correctly, since it has no way to know who
 * asked. Nobody browsing their own template should spend an image lookup on a
 * picture that is only there to show what a layout looks like.
 *
 * `AsyncLocalStorage.exit` drops the store for the callback and everything it
 * awaits, so a meter deep inside finds no user and no-ops by its own
 * documented rule.
 */
export const runUnmetered = <T>(fn: () => Promise<T>): Promise<T> =>
  storage.exit(fn)

/** Everything known about the work currently running, if anything. */
export const currentAttribution = (): UsageAttribution | undefined =>
  storage.getStore()

/** The user currently being metered, if any. */
export const currentUsageUser = (): string | undefined =>
  storage.getStore()?.userId
