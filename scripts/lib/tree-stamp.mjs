/**
 * What a measurement was taken against, printed by the run that took it.
 *
 * WHY THIS IS A STAMP AND NOT A CHECK
 * Three sessions edit this checkout at once, so a measurement taken across
 * runs is taken against different code each time. Checking the tree first and
 * remembering the answer does not help: a version check is a measurement too,
 * and it goes stale at exactly the same rate as the thing it certifies. The
 * only form that survives is a line produced by the same run as the number,
 * which is what this is. Import it for its side effect, or call `stamp()`
 * before printing anything.
 *
 * WHAT IT SAYS, AND WHY IT SAYS IT THAT WAY
 * It names what is unreliable rather than warning in general, and it scopes
 * that to LEVELS. Every row of one sweep is measured in one page load against
 * one tree, so DIFFERENCES between rows survive whatever the tree was; only a
 * figure that has to hold across runs needs the version pinned. A general
 * "working tree is dirty" banner gets ignored, and was, repeatedly.
 *
 * WHY THE FILE HASHES MATTER MORE THAN THE COMMIT
 * The near-miss that prompted this was a CLEAN tree: the file was read from
 * two places, the server drawing from a scratch copy while the probe read the
 * working tree. `git rev-parse` alone reports everything fine and the run is
 * still measuring a slide that cannot exist. So pass the paths the run
 * ACTUALLY OPENED — not the ones it meant to — and each is hashed and
 * compared against the same path at HEAD.
 *
 * USAGE
 *   import { stamp } from './lib/tree-stamp.mjs'
 *   stamp({ files: ['server/config/templates/nyu-elegant.json'] })
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

/** Runs git for text, returning undefined rather than throwing: a stamp must
 * never be the reason a measurement fails to print. */
const git = args => {
  try {
    return execFileSync('git', args, {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

/** Runs git for bytes. Separate from `git` because the committed content must
 * reach the hash untrimmed and undecoded — trimming it would produce a hash of
 * something that was never in the object store. */
const gitBytes = args => {
  try {
    return execFileSync('git', args, {
      cwd: REPO,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return undefined
  }
}

/** The repository this file lives in, found from the file itself so the stamp
 * is correct however the caller was invoked. */
const REPO = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: new URL('.', import.meta.url).pathname,
  encoding: 'utf8',
}).trim()

const sha1 = buffer =>
  createHash('sha1').update(buffer).digest('hex').slice(0, 12)

/**
 * One file's identity, and whether it is the committed one.
 *
 * Three outcomes worth distinguishing, because they fail differently:
 * `committed` — on disk and at HEAD agree, so the hash names something anyone
 * can check out; `differs` — a real file that exists nowhere but here;
 * `outside the repo` — a scratch copy, which is the case that reads as clean
 * and is not.
 */
const fileStamp = path => {
  const abs = resolve(REPO, path)
  const rel = relative(REPO, abs)
  const outside = rel.startsWith('..')
  let disk
  try {
    disk = readFileSync(abs)
  } catch {
    return { path, note: 'UNREADABLE' }
  }
  const hash = sha1(disk)
  if (outside) return { path: abs, hash, note: 'outside the repo' }
  const head = gitBytes(['show', `HEAD:${rel}`])
  const headHash = head ? sha1(head) : undefined
  return {
    path: rel,
    hash,
    note:
      headHash === undefined
        ? 'not tracked at HEAD'
        : headHash === hash
          ? 'committed'
          : `differs from HEAD (${headHash})`,
  }
}

/**
 * Prints the stamp. `files` are the paths the run actually read; each is
 * hashed, because the commit alone cannot see a file read from elsewhere.
 */
export const stamp = ({ files = [], log = console.log } = {}) => {
  const head = git(['rev-parse', '--short', 'HEAD']) ?? 'UNKNOWN'
  const branch = git(['branch', '--show-current']) || 'DETACHED'
  const dirty = git(['status', '--short']) ?? ''
  const changed = dirty ? dirty.split('\n') : []

  log(`TREE ${branch}@${head}`)
  if (changed.length)
    log(
      `  DIRTY — ${changed.length} file(s) differ from HEAD. Any LEVEL below is a\n` +
        '  measurement of a tree that exists nowhere but this machine; differences\n' +
        '  between rows of one run are unaffected.\n' +
        changed.map(line => `    ${line}`).join('\n'),
    )
  else log('  clean — levels below are reproducible from this commit')

  for (const file of files) {
    const s = fileStamp(file)
    log(`  READ ${s.path} ${s.hash ? `sha1:${s.hash} ` : ''}(${s.note})`)
  }
  if (!files.length)
    log(
      '  no files declared — the commit cannot see a file read from elsewhere',
    )
}

export default stamp
