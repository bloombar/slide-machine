/**
 * How a request reached the application (docs/MCP.md §6).
 *
 * Every check the app makes answers "may this account do this". None of them
 * answers "did a person ask for it". Those came apart the moment an external
 * AI assistant could hold a genuine token: an agent acting on an instructor's
 * behalf passes every authorization check, because the authorization is real —
 * the request is simply not necessarily what the instructor wanted. That is
 * the prompt-injection failure mode, and the tool surface is what bounds it
 * (mcp/forbidden.ts); this is what makes it visible afterwards.
 *
 * Recorded rather than inferred. There is nothing on a request to work it out
 * from later — an agent's calls are ordinary calls by the account that
 * authorized them, which is the whole point of the design — so the entry point
 * that knows has to say so at the time.
 *
 * Deliberately about the **channel**, not the actor. Who caused a piece of
 * work and how they reached the app are independent: an assistant editing its
 * owner's lecture is still that lecture's owner (`CostActorKind`), and the
 * interesting new fact is that a machine asked. Overloading either dimension
 * onto the other would lose one of them.
 */

/** The ways a request can arrive. Absent, on a row written before this
 * existed, means `app` — nothing else could reach the action layer then. */
export const ACTOR_CHANNELS = ['app', 'agent'] as const

/**
 * `app` is the application's own front end and everything the server does for
 * itself. `agent` is an external AI assistant over MCP (docs/MCP.md).
 *
 * A future in-app chat assistant (docs/MCP.md §3.4) is a third case and should
 * be named as one when it exists: it is a machine composing the call, but the
 * person is present and watching, which is a materially different risk from an
 * agent working unattended against material the app has never seen.
 */
export type ActorChannel = (typeof ACTOR_CHANNELS)[number]
