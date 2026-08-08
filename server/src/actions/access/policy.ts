/**
 * What an action declares about how it is authorized (SPEC TECH-14).
 *
 * An access policy does two things at once: it decides whether the caller may
 * proceed, and it hands back whatever it had to load to decide. The dispatcher
 * runs it before `meter` and passes the result to `execute`, so an action
 * neither repeats the lookup nor answers an unauthorized caller with a
 * billing error.
 *
 * The `descriptor` is never consulted to make the decision. It exists so the
 * registry test can publish one index of how every registered action is
 * guarded — which makes *weakening* a guard as visible as omitting one.
 *
 * Two rules for anything written here:
 *
 *   - **Mongo only.** Authorization runs outside the usage context
 *     (billing/usage-context.ts), so a policy that called a paid provider
 *     would spend unattributed. Policies read the database and nothing else.
 *   - **Missing and forbidden answer alike.** Every refusal is a bare
 *     `ActionForbiddenError`, so an id cannot be probed to learn whether the
 *     thing behind it exists.
 *
 * Scope boundary: this covers actions dispatched through the action layer.
 * Routes that reach deck data outside it — routes/tts.ts, routes/slides.ts,
 * routes/seed-assets.ts, routes/decks.ts, routes/users.ts and
 * ws/audio-socket.ts — keep their own checks and are NOT covered by the
 * index. A green registry test does not mean the application is fully
 * audited; narrowing that gap is separate work.
 */
import type { ActionContext } from '../context'

/** The kind of thing an action operates on. */
export type AccessResource =
  | 'deck'
  | 'project'
  | 'slide'
  | 'seedAsset'
  | 'template'
  | 'refineJob'
  | 'self'
  | 'none'

/**
 * How much access the caller needs to it. The first five resolve through the
 * one access-control core (lib/access.ts); `author`/`readable` belong to the
 * template visibility model, which is separate by design.
 */
export type AccessLevel =
  /** canViewAcl — public counts, so this admits anyone for a public entity. */
  | 'view'
  /** isAclMember — named on the ACL; ignores public. Gates management views. */
  | 'member'
  /** canEditAcl — the content gate: owner or editor. */
  | 'edit'
  /** canEditAcl OR an allowlisted admin, audited (ADMIN-5). */
  | 'settings'
  /** The same admission as `settings`, for reading it. Writes no audit. */
  | 'settingsView'
  /** ownerId alone — deliberately stricter than `edit`. */
  | 'own'
  /** A template's author. */
  | 'author'
  /** A template anyone may read: built-in, shared, or the caller's own. */
  | 'readable'
  /** The signed-in account itself; the input names no resource. */
  | 'self'
  /** Signed in, nothing more. */
  | 'signedIn'
  /** No requirement beyond the route's own authentication. */
  | 'open'

/** A non-ACL requirement applied after the resource check. */
export type AccessCapability = 'google-drive' | 'verified-email'

/** The machine-readable statement of what a policy protects. */
export interface AccessDescriptor {
  resource: AccessResource
  level: AccessLevel
  capabilities?: readonly AccessCapability[]
  /** Set only by `custom(...)`: why this action authorizes itself. */
  custom?: { reason: string }
}

/**
 * A declared access rule. `authorize` refuses or returns the loaded
 * resource; `R` is what `execute` then receives as its third argument.
 */
export interface AccessPolicy<I = unknown, R = unknown> {
  readonly descriptor: AccessDescriptor
  authorize: (ctx: ActionContext, input: I) => Promise<R>
}

/** Pins the generic types of a policy definition. */
export const definePolicy = <I, R>(
  descriptor: AccessDescriptor,
  authorize: (ctx: ActionContext, input: I) => Promise<R>,
): AccessPolicy<I, R> => ({ descriptor, authorize })

/** Reads an id off the validated input — e.g. `i => i.deckId`. */
export type PickId<I> = (input: I) => string
