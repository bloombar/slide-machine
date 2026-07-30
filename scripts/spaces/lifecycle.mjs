/**
 * lifecycle.mjs — inspect and maintain multipart hygiene on the Spaces bucket.
 *
 * WHY THIS EXISTS
 * Retained lecture audio streams to object storage as a multipart upload (see
 * docs/AUDIO.md). An upload interrupted by a crash, an OOM kill, or a deploy
 * restart leaves parts behind that consume paid storage and never appear in
 * object listings — so the cost is invisible and nothing surfaces the leak.
 * The app aborts explicitly on every failure path it can observe, but a killed
 * process cannot clean up after itself. The bucket therefore needs an
 * `AbortIncompleteMultipartUpload` lifecycle rule as the backstop, and someone
 * occasionally needs to confirm it is still in place.
 *
 * WHY NOT JUST USE THE AWS CLI
 * `aws s3api get-bucket-lifecycle-configuration` CRASHES against Spaces with
 * "argument of type 'NoneType' is not a container or iterable". Spaces returns
 * the legacy rule form containing an empty `<Prefix></Prefix>`, which parses to
 * None and breaks the CLI's output formatter. The error is purely cosmetic —
 * the HTTP call succeeded and a rule may well be applied — but it reads exactly
 * like a failure, and the tempting next step is to re-apply the rule. That is
 * dangerous, because `PutBucketLifecycleConfiguration` REPLACES the entire
 * configuration rather than appending to it, so a blind re-apply can silently
 * drop other rules (such as an `audio/` expiry). This script reads the response
 * correctly and merges rather than replacing.
 *
 * USAGE
 *   node scripts/spaces/lifecycle.mjs                     # report only (default)
 *   node scripts/spaces/lifecycle.mjs --apply-abort-rule  # add/refresh the rule
 *   node scripts/spaces/lifecycle.mjs --abort-orphans     # clear stranded uploads
 *
 * FLAGS
 *   --apply-abort-rule    Write the AbortIncompleteMultipartUpload rule,
 *                         preserving every other rule already configured.
 *   --abort-orphans       Abort incomplete multipart uploads. DESTRUCTIVE, and
 *                         opt-in: uploads younger than --min-age-minutes are
 *                         skipped because a lecture recording in progress holds
 *                         one open, and aborting it kills that recording.
 *   --days N              DaysAfterInitiation for the rule (default 7).
 *   --min-age-minutes N   Age below which an upload is left alone (default 60).
 *   --prefix P            Scope the rule to a key prefix (default: whole bucket).
 *   --env-file PATH       Load S3_* credentials from a .env file, e.g.
 *                         server/.env.production. Explicit on purpose: nobody
 *                         should touch production storage by accident.
 *
 * CREDENTIALS
 * Reads S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 * from the environment (or --env-file), falling back to AWS_* for the key pair.
 *
 * Lifecycle operations need a FULL-ACCESS Spaces key. The application's own key
 * is denied them — which is correct, since the app never performs them — so
 * running this with the app's credentials reports AccessDenied on the lifecycle
 * calls while the multipart calls still work. An exported variable beats the
 * --env-file, so point at the deployment's file for the endpoint and bucket
 * while supplying a stronger key:
 *
 *   export S3_ACCESS_KEY_ID=$(aws configure get aws_access_key_id --profile spaces)
 *   export S3_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key --profile spaces)
 *   npm run spaces:lifecycle -- --env-file server/.env.production
 */
import { readFileSync } from 'node:fs'
import {
  AbortMultipartUploadCommand,
  GetBucketLifecycleConfigurationCommand,
  ListMultipartUploadsCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from '@aws-sdk/client-s3'

const RULE_ID = 'abort-incomplete-mpu'

const argv = process.argv.slice(2)
const has = flag => argv.includes(flag)
const value = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i === -1 ? fallback : argv[i + 1]
}

const days = Number(value('--days', 7))
const minAgeMinutes = Number(value('--min-age-minutes', 60))
const prefix = value('--prefix', '')

/** Loads KEY=value lines from a .env file into process.env (without overriding
 * anything already set, so an explicit export still wins). */
const loadEnvFile = path => {
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim()
  }
}
const envFile = value('--env-file', null)
if (envFile) loadEnvFile(envFile)

const required = name => {
  const v = process.env[name]
  if (!v) {
    console.error(
      `Missing ${name}. Set it, or pass --env-file server/.env.production.`,
    )
    process.exit(1)
  }
  return v
}

const Bucket = required('S3_BUCKET')
const client = new S3Client({
  endpoint: required('S3_ENDPOINT'),
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? required('AWS_ACCESS_KEY_ID'),
    secretAccessKey:
      process.env.S3_SECRET_ACCESS_KEY ?? required('AWS_SECRET_ACCESS_KEY'),
  },
})

/** Current rules, or null when they cannot be read. `null` and `[]` mean very
 * different things: `[]` is "no rules configured, safe to write", `null` is
 * "unknown — writing would replace something we cannot see". */
const readRules = async () => {
  try {
    const res = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket }),
    )
    return res.Rules ?? []
  } catch (error) {
    if (error.name === 'NoSuchLifecycleConfiguration') return []
    console.error(
      `Could not read the lifecycle configuration: ${error.name}` +
        (error.name === 'AccessDenied'
          ? ' — this key lacks lifecycle permission. Use a full-access Spaces key.'
          : ''),
    )
    return null
  }
}

/** Every incomplete multipart upload, following pagination. */
const readOpenUploads = async () => {
  const out = []
  let KeyMarker
  let UploadIdMarker
  do {
    const page = await client.send(
      new ListMultipartUploadsCommand({ Bucket, KeyMarker, UploadIdMarker }),
    )
    out.push(...(page.Uploads ?? []))
    KeyMarker = page.IsTruncated ? page.NextKeyMarker : undefined
    UploadIdMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined
  } while (KeyMarker || UploadIdMarker)
  return out
}

const ageMinutes = upload =>
  (Date.now() - new Date(upload.Initiated).getTime()) / 60000

// --- report (always) -------------------------------------------------------

console.log(`bucket: ${Bucket}`)
const rules = await readRules()

if (rules === null) {
  console.log('lifecycle rules: UNREADABLE (see error above)')
} else if (!rules.length) {
  console.log('lifecycle rules: none configured')
} else {
  console.log(`lifecycle rules: ${rules.length}`)
  for (const rule of rules) {
    const abort = rule.AbortIncompleteMultipartUpload
    console.log(
      `  - ${rule.ID ?? '(unnamed)'} [${rule.Status}]` +
        (abort ? ` abort-incomplete after ${abort.DaysAfterInitiation}d` : '') +
        (rule.Expiration ? ` expire ${JSON.stringify(rule.Expiration)}` : ''),
    )
  }
}

// Three states, not two: "could not read" is not evidence of absence, and
// reporting it as a missing rule would send someone to re-apply one that may
// already exist — the exact move that replaces the whole configuration.
console.log(
  rules === null
    ? '→ UNKNOWN whether incomplete uploads are swept — could not read the rules'
    : rules.some(rule => rule.AbortIncompleteMultipartUpload)
      ? '→ incomplete uploads ARE swept by a lifecycle rule'
      : '→ NO abort rule: a crashed upload would leak parts indefinitely',
)

const open = await readOpenUploads().catch(error => {
  console.error(`Could not list multipart uploads: ${error.name}`)
  return []
})
console.log(`\nincomplete uploads right now: ${open.length}`)
for (const upload of open) {
  const age = ageMinutes(upload)
  console.log(
    `  - ${upload.Key}  age=${age.toFixed(0)}m` +
      (age < minAgeMinutes ? '  (recent — may be a live recording)' : ''),
  )
}

// --- apply the rule --------------------------------------------------------

if (has('--apply-abort-rule')) {
  if (rules === null) {
    console.error(
      '\nRefusing to write: the existing configuration could not be read, and ' +
        'a write REPLACES it entirely. Fix the permission first.',
    )
    process.exit(1)
  }
  // Keep every other rule; replace only ours if it is already present.
  const merged = [
    ...rules.filter(rule => rule.ID !== RULE_ID),
    {
      ID: RULE_ID,
      Status: 'Enabled',
      Filter: { Prefix: prefix },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: days },
    },
  ]
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket,
      LifecycleConfiguration: { Rules: merged },
    }),
  )
  console.log(
    `\napplied "${RULE_ID}" (${days}d, prefix "${prefix}"); ` +
      `${merged.length - 1} other rule(s) preserved`,
  )
}

// --- abort stranded uploads ------------------------------------------------

if (has('--abort-orphans')) {
  const stale = open.filter(upload => ageMinutes(upload) >= minAgeMinutes)
  const skipped = open.length - stale.length
  if (skipped) {
    console.log(
      `\nskipping ${skipped} upload(s) younger than ${minAgeMinutes}m — ` +
        'a recording in progress holds one open',
    )
  }
  for (const upload of stale) {
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket,
        Key: upload.Key,
        UploadId: upload.UploadId,
      }),
    )
    console.log(`aborted ${upload.Key}`)
  }
  console.log(`\naborted ${stale.length} stranded upload(s)`)
}
