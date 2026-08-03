# Deploying Slide Machine (DO App Platform + Spaces + MongoDB Atlas)

Slide Machine deploys as a single DigitalOcean App Platform service — the
Express monolith serving both `/api` and the built React SPA — backed by a
MongoDB Atlas cluster and a DO Spaces bucket. The tracked spec is
[.do/app.yaml](../.do/app.yaml).

These steps are the same whether you're standing up a permanent production
app or a throwaway one to smoke-test a branch; the only differences are the
`deploy_on_push` setting and whether you run the teardown at the end (§9). A
disposable run also just uses `-dry`-suffixed names and Atlas's free tier.

## What you need

- A DigitalOcean account with billing enabled, and `doctl` authed
  (`doctl auth init`) — or use the dashboard for every `doctl` step.
- A MongoDB Atlas account (the free **M0** tier is fine for trials; use a
  paid dedicated tier for a real production workload).
- The DigitalOcean GitHub app granted access to the repo
  (dashboard → Settings → GitHub, or you'll be prompted on app create).
- Google Cloud credentials for generation, speech, and sign-in — a Gemini
  API key, a Speech-to-Text service account, and an OAuth client. See
  [docs/GOOGLE_API_KEYS.md](GOOGLE_API_KEYS.md) and
  [docs/GOOGLE_SIGN_IN.md](GOOGLE_SIGN_IN.md).

Rough cost: `basic-xxs` ~$5/mo + Spaces ~$5/mo (both billed hourly, so a
same-day dry run is under $1); Atlas M0 is free, dedicated tiers are not.

## 1. MongoDB Atlas

1. Create a cluster (Atlas UI → **Build a Database**) in a region near the
   app — e.g. AWS `us-east-1` for DO `nyc`. **M0** (free) for a dry run.
2. Under **Database Access**, add a database user with a password.
3. Under **Network Access**, add `0.0.0.0/0` to start (open to any IP). For
   production, lock it to the app's **dedicated egress IPs** instead
   (dashboard → app → Settings → dedicated egress IPs, if enabled).
4. From **Connect → Drivers**, copy the `mongodb+srv://` string, insert the
   user's password, and set the database path to `/slide-machine`. This is
   the `MONGODB_URI` value.

## 2. DO Spaces (object storage for uploads)

Seed-material uploads go through the `s3` storage adapter
([server/src/storage/index.ts](../server/src/storage/index.ts)), which writes
objects with a `public-read` ACL and serves them from `S3_PUBLIC_BASE_URL`.

1. Create a bucket: dashboard → **Spaces → Create**, in your region (e.g.
   `nyc3`). Name it e.g. `slide-machine` (or `slide-machine-dry`). Enable the
   **CDN**.
2. Create a **Spaces access key** (API → Spaces Keys). Note the key + secret.
3. These map to the `S3_*` env vars in §6 (`S3_ENDPOINT`, `S3_REGION`,
   `S3_BUCKET`, the key pair, and `S3_PUBLIC_BASE_URL`).

### Optional: expire retained lecture audio (`audio/` prefix)

If `AUDIO_RETENTION_ENABLED=true` (GEN-4), each live session's audio is stored
as raw LINEAR16 PCM under the **`audio/`** key prefix — large (~2.9 MB/min at
the default 24 kHz `STT_CAPTURE_SAMPLE_RATE`, ~1.9 at 16 kHz, ~5.8 at 48 kHz) and
containing student voices. The app already runs a daily sweep that deletes
expired recordings along with their deck references, so no bucket rule is
required. The window is the shorter of the owner's plan tier
(`audioRetentionDays` in `config/plans.json`) and `AUDIO_RETENTION_DAYS`
(default 30). As a belt-and-suspenders guard you
may **also** add a Spaces/S3 **lifecycle expiration rule scoped to the `audio/`
prefix** (e.g. 30 days) — dashboard → your Space → **Settings → Lifecycle
rules**.

> **Do not add it with a bare `s3api put-bucket-lifecycle-configuration`.** That
> call replaces the entire configuration, so it would silently delete the
> required `AbortIncompleteMultipartUpload` rule below. Read the current rules
> and write back the merged set — which is what
> `npm run spaces:lifecycle` does ([AUDIO.md](AUDIO.md#maintaining-the-bucket)).
Audio is **streamed** to storage as it arrives, so a session's memory cost is a
fixed in-flight window (~11 MB) rather than its whole length — a three-hour
lecture costs the same as a three-minute one. Two ceilings bound it:
`AUDIO_RETENTION_MAX_SESSION_MB` (default `300`) limits how much a single
lecture may **store** (past it the recording is truncated), and
`AUDIO_RETENTION_MAX_TOTAL_MB` (default `128`) limits the **memory** across all
concurrent sessions, so it effectively caps how many lectures may record at once
— roughly its value ÷ 11. Audio buffers sit outside the V8 heap, so an overrun
shows up as RSS growth and an OOM kill rather than a catchable error: **size the
total to the host's RAM**, well under the container limit. Past either ceiling
the affected sessions transcribe without retaining audio; transcription, slide
generation, and the transcript are never affected.

Full pipeline — capture, downsampling, streaming, storage format, playback, and
diarization — is documented in [AUDIO.md](AUDIO.md).

> **Required: abort incomplete multipart uploads.** Streaming uses multipart
> uploads, and one interrupted by a crash or a dropped connection leaves parts
> that consume paid storage and do **not** appear in object listings — so the
> cost is invisible. The app aborts explicitly on every failure path it can see
> (`Upload.abort()` alone proved insufficient on Spaces, so it also sweeps the
> key), but a killed process cannot clean up after itself. Add an
> **`AbortIncompleteMultipartUpload` lifecycle rule** (e.g. 7 days) on the
> bucket as the backstop. Spaces supports it; set it with a full-access Spaces
> key, since the app's own key is denied lifecycle operations (and never needs
> them):
>
> ```sh
> npm run spaces:lifecycle -- --env-file server/.env.production --apply-abort-rule
> ```
>
> Run the same command without `--apply-abort-rule` any time to check the rule
> is still there and to see stranded uploads. Do not reach for the AWS CLI: it
> crashes displaying this rule, which makes an applied rule look like a failure.
> Details in [AUDIO.md](AUDIO.md#maintaining-the-bucket).

**Scope it to `audio/`** — an unprefixed rule would also expire slide images
(`slides/`), TTS narration (`tts/`), and seed files (`seed/`). Note the bucket
rule is blind to the app's DB, so it can leave a deck reference pointing at an
already-expired object; the app tolerates a missing audio object on read.

## 3. Google Cloud credentials

Follow [docs/GOOGLE_API_KEYS.md](GOOGLE_API_KEYS.md) to create each of:

- **`GEMINI_API_KEY`** — slide/quiz/image generation. (Set
  `GENERATION_PROVIDER=mock` to boot without it, but real generation is the
  point.)
- **`GOOGLE_APPLICATION_CREDENTIALS_JSON`** — the Speech-to-Text
  service-account key, pasted **inline as one line of JSON**. The key *file*
  is gitignored and dockerignored, so it never reaches the container; the
  file-path variable (`GOOGLE_APPLICATION_CREDENTIALS`) will not work in the
  deployed env — use the `_JSON` form.
- **`GOOGLE_CLOUD_TRANSLATION_KEY`** — translation API key.
- **`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`** — the OAuth
  client for "Continue with Google" (see also §7).

Streaming STT needs a service account, not an API key. Skip STT entirely by
leaving `TRANSCRIPTION_PROVIDER=browser` (the keyless client engine).

## 4. Create the App Platform app

The tracked [.do/app.yaml](../.do/app.yaml) declares the service (Dockerfile
build, `http_port: 3000`, `basic-xxs`, health check `/api/health`, region
`nyc`) and every env key. Create the app from it:

```sh
doctl apps create --spec .do/app.yaml
```

`doctl apps create` prints the new app's **ID** (a UUID). That value is the
`<app-id>` every later `doctl apps …` command expects — grab it from the
create output, or look it up anytime with `doctl apps list` (or
`doctl apps list --format ID,Spec.Name,DefaultIngress`, which also shows each
app's URL). In the dashboard it's the last path segment of the app's URL
(`cloud.digitalocean.com/apps/<app-id>`).

The same spec serves both cases; only a few fields differ:

- **Permanent deployment** — keep the real `name`, point `github.branch` at
  your release branch, and set `github.deploy_on_push` to whatever you want
  (see below).
- **Disposable dry run** — before creating, edit the spec so it can't collide
  with a permanent app: give it a throwaway `name` (e.g. `slide-machine-dry`),
  set `github.deploy_on_push: false` (deploy only on demand), point
  `github.branch` at the branch under test, and use the `-dry` Space/cluster
  from §1–§2. Revert those edits when you're done (§9).

Two fields control *what* and *when* to deploy:

- **`github.branch`** — the branch to deploy from. `master` is the
  conventional default, but it can be **any** branch; there's nothing special
  about `master` here (the tracked spec currently points at `better-faster`).
  Set it to whichever branch you want this app to track.
- **`github.deploy_on_push`** — this is the continuous-deployment switch.
  `true` means every push to that branch auto-builds and deploys (CD). `false`
  means deploys happen only when you trigger them
  (`doctl apps create-deployment <app-id>`), which is what you want for a
  controlled or disposable run.

## 5. Environment variables

Set these on the `web` component (dashboard → app → Settings → the `web`
component → Environment Variables, or in the spec). **Secret** values should
be encrypted; **plain** values can be set directly; the one **build-time**
value is baked into the SPA at build.

| Variable | Type | Value / how to get it |
| --- | --- | --- |
| `NODE_ENV` | plain | `production` |
| `MONGODB_URI` | secret | Atlas `mongodb+srv://…/slide-machine` string (§1) |
| `JWT_SECRET` | secret | `openssl rand -base64 48` (min 32 chars) |
| `JWT_REFRESH_SECRET` | secret | `openssl rand -base64 48` (min 32 chars) |
| `PUBLIC_BASE_URL` | plain (runtime) | `${_self.PUBLIC_URL}` to auto-use the app's URL, or your custom domain. A trailing slash is fine (the app strips it). |
| `GEMINI_API_KEY` | secret | Gemini key (§3) |
| `TRANSCRIPTION_PROVIDER` | plain | `google-cloud` for real-time STT; `browser` for the keyless client engine |
| `GOOGLE_APPLICATION_CREDENTIALS_JSON` | secret | full service-account key JSON, one line (§3) |
| `GOOGLE_CLOUD_TRANSLATION_KEY` | secret | translation API key (§3) |
| `GOOGLE_OAUTH_CLIENT_ID` | secret | OAuth client id (§3, §7) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | secret | OAuth client secret (§3, §7) |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | plain, **build-time** | the same OAuth client id. Vite inlines it at build so the "Continue with Google" button renders. **Scope must be Build-time** — bindables like `${_self.PUBLIC_URL}` can't be used at build. It's public (ships in the bundle), so not a secret. |
| `FLICKR_API_KEY` | secret | image enrichment (optional) |
| `STORAGE_PROVIDER` | plain | `s3` |
| `S3_ENDPOINT` | plain | `https://<region>.digitaloceanspaces.com` |
| `S3_REGION` | plain | e.g. `nyc3` |
| `S3_BUCKET` | plain | your Space's name |
| `S3_ACCESS_KEY_ID` | secret | Spaces key (§2) |
| `S3_SECRET_ACCESS_KEY` | secret | Spaces secret (§2) |
| `S3_PUBLIC_BASE_URL` | plain | `https://<bucket>.<region>.cdn.digitaloceanspaces.com` |
| `S3_FORCE_PATH_STYLE` | plain | leave unset/`false` for Spaces (`true` is MinIO-only) |
| `AUDIO_RETENTION_ENABLED` | plain | `true` to retain live-session audio for diarization (GEN-4); default off. Needs `TRANSCRIPTION_PROVIDER=google-cloud` |
| `AUDIO_RETENTION_DAYS` | plain | deployment-wide ceiling on the retention window; default `30`, `0` = sweep off, keep forever (see §2 lifecycle note). Each plan tier sets its own `audioRetentionDays` in `config/plans.json` and the **shorter of the two wins**, so this can tighten a tier's window but never loosen it |
| `AUDIO_RETENTION_MAX_SESSION_MB` | plain | how much audio one session may **store**; default `300` (~1 h 49 min at 24 kHz), `0` = no per-session cap. Past it that recording is truncated |
| `AUDIO_RETENTION_MAX_TOTAL_MB` | plain | **memory** ceiling across all concurrent recordings (~11 MB each), so ≈ how many may record at once; default `128`, `0` = no limit. **Size to the host's RAM** — see §2 |
| `STT_CAPTURE_SAMPLE_RATE` | plain | Hz the browser downsamples mic audio to before streaming; default `24000` (16 kHz is what Cloud STT expects; the extra is for per-slide playback fidelity), range `8000`–`48000`, `0` = no downsampling (stream the mic's native rate). Raising it multiplies bandwidth, retention memory, and stored WAV size. Optional |
| `DELETED_DATA_RETENTION_DAYS` | plain | days a soft-deleted record is kept before the daily sweep purges it and its blobs (P-11); default `90`, `0` = keep tombstones forever |
| `WHITEBOARD_SUPPRESS_DEBOUNCE_MS` | plain | grace (ms) after the last whiteboard gesture during which speech folds into the current slide instead of creating one (EDIT-4); default `5000`, `0` disables. Optional |
| `SIMULATED_SPEECH_ENABLED` | plain | `true` shows the live session's simulated-speech text box for typing phrases instead of speaking them — a debugging aid; default off. Optional |

> **`0` means "no limit", not "off".** For `STT_CAPTURE_SAMPLE_RATE`,
> `AUDIO_RETENTION_DAYS`, `AUDIO_RETENTION_MAX_SESSION_MB`,
> `AUDIO_RETENTION_MAX_TOTAL_MB`, and `DELETED_DATA_RETENTION_DAYS`, setting `0`
> **removes** a bound — so it costs more, not less: no downsampling, recordings
> kept forever, unbounded buffers, tombstones never purged. On a production host
> that means unbounded storage growth or an OOM kill. The one exception is
> `WHITEBOARD_SUPPRESS_DEBOUNCE_MS`, where `0` is a literal zero-length grace
> window and so genuinely disables the behavior.

Optional, as features land: `GITHUB_OAUTH_CLIENT_ID` / `_SECRET`,
`CONNECTED_ACCOUNT_TOKEN_ENC_KEY`, `STRIPE_SECRET_KEY` /
`STRIPE_WEBHOOK_SECRET` (products, prices, webhook, and the rest of billing
setup: [STRIPE.md](STRIPE.md)), and the `SMTP_*` set (email verification /
reset). Full list and defaults: [server/.env.example](../server/.env.example).

## 6. Register the Google OAuth redirect URI

Google returns to `<origin>/api/auth/google/callback`, which the server
builds from `PUBLIC_BASE_URL`
([server/src/auth/google.ts](../server/src/auth/google.ts)) and must match a
URI registered in the OAuth client **byte-for-byte**. So this comes after the
app has a URL:

1. Note the app's URL (`doctl apps get <app-id>`, or the dashboard) — e.g.
   `https://slide-machine-xxxxx.ondigitalocean.app`.
2. In the Google Cloud Console → **Credentials** → your OAuth client, add
   `<origin>/api/auth/google/callback` as an **Authorized redirect URI**.

Because `${_self.PUBLIC_URL}` yields the random `…ondigitalocean.app`
hostname (which changes if the app is recreated), attach a **custom domain**
(dashboard → app → Settings → Domains) for a stable redirect URI in
production, and register that instead. Skip this section and email/password
sign-in still works — only the Google button needs it.

## 7. Deploy and check health

If `deploy_on_push: true`, pushing to the tracked branch deploys
automatically; otherwise trigger it: `doctl apps create-deployment <app-id>`.
The Dockerfile multi-stage build runs and the container must pass the
`/api/health` check on port 3000.

At `<app-url>/api/health`, the body reads `"status": "ok", "mongo":
"connected"`. Note the endpoint returns **200 even when Mongo is down** (by
design, so a transient DB blip doesn't flap the platform health check) — read
the JSON body, not just the status code. Tail runtime logs with
`doctl apps logs <app-id> --type run`.

## 8. Smoke-test the core loop

At the app URL, in order:

1. Register an account (or use Google sign-in if §6 is set up); reload — the
   session survives (JWT + refresh). A signed-in session is required before
   the Speak flow works.
2. Create a project, start a lecture, and speak (Chrome mic, or the typed
   Speak bar): coherent Gemini slides appear in ~1s per phrase.
3. In lecture settings, upload a seed image. Confirm the object landed in the
   Spaces bucket and the thumbnail loads from the `cdn.digitaloceanspaces.com`
   URL (public-read ACL working).
4. Open a deck permalink in a private window (logged out) — public decks
   render read-only.
5. Skim `doctl apps logs <app-id> --type run` for errors.

## 9. Teardown

For a disposable run, or to decommission an app:

```sh
doctl apps delete <app-id>
```

Then delete the Atlas cluster (Atlas UI → cluster → **Terminate**) and the
Space plus its access key in the DO dashboard (no `doctl` for Spaces). If you
edited `name`, `github.branch`, or `github.deploy_on_push` in
[.do/app.yaml](../.do/app.yaml) for the dry run, revert those edits.
