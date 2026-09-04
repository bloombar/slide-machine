/**
 * DTO for GET /api/health — the status endpoint behind the footer health
 * badge, integration tests, and the DO App Platform health check.
 *
 * The overall `status` is the compact summary the badge shows collapsed;
 * `components` is the per-service breakdown the badge reveals when expanded.
 */

/** Per-component health. `disabled` = not the active provider / configured off. */
export type ComponentStatus = 'ok' | 'degraded' | 'down' | 'disabled'

export interface HealthComponent {
  status: ComponentStatus
  /** Human-readable state, e.g. 'connected', 's3 (spaces)', 'auth failed'. */
  detail?: string
}

/** The components reported in every health response. */
export interface HealthComponents {
  mongo: HealthComponent
  storage: HealthComponent
  /** GCS bucket that retained lecture audio is staged in for batch diarization;
   * `disabled` (falls back to local/blob storage) when no bucket is configured. */
  audioStorage: HealthComponent
  gemini: HealthComponent
  stt: HealthComponent
  tts: HealthComponent
  /** Slide-content translation for post-lecture translated viewing (SHARE-2);
   * `disabled` when no translator is configured. */
  translation: HealthComponent
}

export interface HealthResponse {
  /** Overall summary: `down` only when the core (Mongo) is unreachable. */
  status: 'ok' | 'degraded' | 'down'
  /** Deployment mode — dev vs production. */
  environment: 'development' | 'test' | 'production'
  /** CalVer app version, `YYYY.MM.DD+<git-sha>` (see server app-version). */
  version: string
  /** Server process uptime in seconds. */
  uptime: number
  /**
   * How many entries this request's `X-Forwarded-For` carried on arrival, so
   * `TRUST_PROXY_HOPS` can be measured against reality rather than assumed.
   *
   * Named for what it is rather than for what it is usually used for. It is
   * **not** a count of proxies: proxies append to the header, so whatever the
   * caller sent is in here too. It equals the chain length only for a request
   * that sent no `X-Forwarded-For` of its own, which is a property of how the
   * measurement is taken and not something this endpoint can check.
   *
   * A count, never an address — no address is reported here or anywhere. The
   * configured hop count is deliberately not reported beside it: an operator
   * already knows what they set, and publishing it on an endpoint that needs
   * no credentials would tell everyone else which limiters are currently a
   * shared bucket, or spoofable.
   */
  proxy: { xffEntries: number }
  components: HealthComponents
}
