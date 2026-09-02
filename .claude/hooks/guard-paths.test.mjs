/**
 * Tests for the PreToolUse path guard.
 *
 * This hook is the only mechanism standing between an agent and the `.env`
 * files holding this project's live credentials — the production Mongo Atlas
 * URI, the JWT signing secrets, Stripe and S3 keys — or the research study
 * data under `docs/study/data/`. A regression here is silent — the hook simply
 * stops blocking — so it is tested like production code.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'guard-paths.sh')

/** Runs the hook with a payload; returns its exit code. */
const runHook = payload => {
  try {
    execFileSync(HOOK, {
      input: JSON.stringify(payload),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return 0
  } catch (error) {
    return error.status
  }
}

const BLOCKED = 2
const ALLOWED = 0

const write = file_path => ({ tool_name: 'Write', tool_input: { file_path } })
const bash = command => ({ tool_name: 'Bash', tool_input: { command } })

test('blocks writes to environment files holding live credentials', () => {
  for (const path of [
    '.env',
    '.env.production',
    'server/.env',
    'server/.env.production',
    'client/.env',
    '/abs/path/slide-machine/server/.env.production',
  ])
    assert.equal(runHook(write(path)), BLOCKED, path)
})

test('blocks writes to research study data', () => {
  // P-14: no dataset ever enters the repository.
  assert.equal(runHook(write('docs/study/data/session-telemetry.csv')), BLOCKED)
  assert.equal(
    runHook(write('/abs/path/slide-machine/docs/study/data/export.csv')),
    BLOCKED,
  )
})

test('blocks a force-add, which is how a gitignored secret reaches the repo', () => {
  assert.equal(runHook(bash('git add -f server/.env.production')), BLOCKED)
})

test('blocks commands that delete or overwrite a protected path', () => {
  assert.equal(runHook(bash('rm -f server/.env.production')), BLOCKED)
  assert.equal(runHook(bash('echo X=1 > server/.env')), BLOCKED)
})

test('allows the tracked env templates', () => {
  // `.env.example` is committed and carries no secrets; the `.env.*` rule
  // would block it without an explicit exception, which would stop ordinary
  // work on the templates themselves.
  for (const path of [
    '.env.example',
    'server/.env.example',
    'client/.env.example',
  ])
    assert.equal(runHook(write(path)), ALLOWED, path)
  assert.equal(runHook(bash('rm -f server/.env.example')), ALLOWED)
})

test('allows the study docs that are not data', () => {
  // The protocol and instruments are prose the work regularly touches; only
  // `docs/study/data/` holds datasets.
  assert.equal(runHook(write('docs/study/PROTOCOL.md')), ALLOWED)
  assert.equal(runHook(write('docs/study/INSTRUMENTS.md')), ALLOWED)
})

test('allows ordinary source files', () => {
  assert.equal(runHook(write('server/src/actions/project.ts')), ALLOWED)
  assert.equal(
    runHook(write('client/src/components/SlideMarkdown.tsx')),
    ALLOWED,
  )
  assert.equal(runHook(bash('npm run typecheck')), ALLOWED)
})

test('allows reads of protected paths — the risk is modification, not inspection', () => {
  assert.equal(
    runHook(bash("grep -E '^[A-Z_]+=' server/.env.production")),
    ALLOWED,
  )
})

test('only the first line is inspected, so prose about a protected path is not a command', () => {
  // Regression: the guard originally matched the whole command string, so a
  // commit message describing the guard tripped the guard. An over-broad rule
  // that blocks honest work is how people learn to disable the rule.
  const message = [
    "git commit -F - <<'EOF'",
    'Add guardrails',
    '',
    'Blocks writes to .env files, and refuses git add -f.',
    'EOF',
  ].join('\n')
  assert.equal(runHook(bash(message)), ALLOWED)
  assert.equal(runHook(bash('git add -A')), ALLOWED)
  assert.equal(runHook(bash('grep -r "\\.env" docs/')), ALLOWED)
  assert.equal(runHook(bash('echo "never commit .env"')), ALLOWED)
})

test('a malformed payload does not block work', () => {
  // A hook that fails open on garbage is right: it runs before every tool call,
  // and an unparseable payload is a bug in the harness, not an attack.
  assert.equal(runHook({}), ALLOWED)
})
