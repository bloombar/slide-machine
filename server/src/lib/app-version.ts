/**
 * App version in Calendar Versioning (CalVer): `YYYY.MM.DD+<git-sha>`, e.g.
 * `2026.07.18+a1b2c3d`. Auto-generated per push — no manual bump.
 *
 * `computeAppVersion()` runs both at build time (inlined into the production
 * bundle by tsup's `define`, see tsup.config.ts) and, in `tsx` dev where no
 * define exists, at server boot. It reads the git short-sha straight from
 * `.git` (no `git` binary needed) so it works inside the minimal Alpine
 * build image, and degrades gracefully — date-only, then the package
 * version — when git metadata is unavailable.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Walks up from a start dir to the repo/package root that owns `.git`/package.json. */
const findRoot = (startDir: string): string => {
  let dir = startDir
  while (
    !existsSync(path.join(dir, '.git')) &&
    !existsSync(path.join(dir, 'package.json'))
  ) {
    const parent = path.dirname(dir)
    if (parent === dir) return startDir
    dir = parent
  }
  return dir
}

/**
 * Resolves the current commit's short sha by reading `.git` directly:
 * `.git/HEAD` → a detached sha, or a `ref:` we follow to the loose ref
 * file, falling back to a scan of `.git/packed-refs`. Returns null when no
 * git metadata is present (e.g. a build context without `.git`).
 */
const gitShortSha = (startDir: string): string | null => {
  try {
    // Walk up to the directory that contains `.git`.
    let dir = startDir
    while (!existsSync(path.join(dir, '.git'))) {
      const parent = path.dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
    const gitDir = path.join(dir, '.git')
    const head = readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim()

    // Detached HEAD: the sha sits right in HEAD.
    if (!head.startsWith('ref:')) return head.slice(0, 7)

    const ref = head.slice(4).trim() // e.g. 'refs/heads/better-faster'
    const loose = path.join(gitDir, ref)
    if (existsSync(loose)) {
      return readFileSync(loose, 'utf8').trim().slice(0, 7)
    }

    // Loose ref missing (packed): find the ref in packed-refs.
    const packed = path.join(gitDir, 'packed-refs')
    if (existsSync(packed)) {
      for (const line of readFileSync(packed, 'utf8').split('\n')) {
        if (line.startsWith('#') || line.startsWith('^')) continue
        const [sha, name] = line.trim().split(' ')
        if (name === ref && sha) return sha.slice(0, 7)
      }
    }
    return null
  } catch {
    return null
  }
}

/** `YYYY.MM.DD` in UTC for today. */
const calverDate = (): string => {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  return `${y}.${m}.${d}`
}

/**
 * Computes the CalVer version string. Honors an explicit `APP_VERSION`
 * override (for CI or hosts that inject it), else `YYYY.MM.DD+<sha>`, else
 * date-only, else the package version.
 */
export const computeAppVersion = (): string => {
  if (process.env.APP_VERSION) return process.env.APP_VERSION

  const start = path.dirname(fileURLToPath(import.meta.url))
  const root = findRoot(start)
  const date = calverDate()
  const sha = gitShortSha(root)
  if (sha) return `${date}+${sha}`
  if (date) return date
  return process.env.npm_package_version ?? '0.0.0'
}

/**
 * The resolved app version. In the production bundle `__APP_VERSION__` is
 * inlined by tsup at build time; under `tsx` dev it is undefined, so we
 * compute from the repo's `.git` at boot.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__
    ? __APP_VERSION__
    : computeAppVersion()
