/**
 * Build-time globals injected by tsup's `define` (see tsup.config.ts).
 * `__APP_VERSION__` is the CalVer string inlined into the production bundle;
 * it is `undefined` under `tsx` dev, where the value is computed at runtime.
 */
declare const __APP_VERSION__: string | undefined
