/**
 * Provider-layer errors that map to friendly HTTP responses. Kept separate
 * from the HTTP middleware so provider adapters don't depend on Express.
 */

/**
 * An AI provider couldn't fulfil a request because it is rate-limited, out of
 * quota/credits, or transiently overloaded. The `message` is user-facing;
 * `retryable` distinguishes a transient overload from an exhausted quota.
 */
export class GenerationUnavailableError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'GenerationUnavailableError'
  }
}
