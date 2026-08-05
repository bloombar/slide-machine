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
  components: HealthComponents
}
