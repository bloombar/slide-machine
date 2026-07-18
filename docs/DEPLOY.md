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

Optional, as features land: `GITHUB_OAUTH_CLIENT_ID` / `_SECRET`,
`CONNECTED_ACCOUNT_TOKEN_ENC_KEY`, `STRIPE_SECRET_KEY` /
`STRIPE_WEBHOOK_SECRET`, and the `SMTP_*` set (email verification / reset).
Full list and defaults: [server/.env.example](../server/.env.example).

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
