# Deployment dry-run: DO App Platform + Spaces + MongoDB Atlas

Proves the Phase 1 exit criterion — "the core loop runs on DO for one
user" (see [ROADMAP §5](ROADMAP.md)) — without touching the production
wiring in [.do/app.yaml](../.do/app.yaml), which auto-deploys `master`.
Everything below is disposable; teardown is the last step.

## What you need

- A DigitalOcean account with billing enabled, and `doctl` authed
  (`doctl auth init`) — or use the dashboard for every `doctl` step.
- A MongoDB Atlas account (the free M0 tier is enough for the dry run).
- The DigitalOcean GitHub app granted access to `bloombar/slide-machine`
  (dashboard → Settings → GitHub, or you'll be prompted on app create).
- The `GEMINI_API_KEY` from `server/.env` (real generation is part of
  the point; setting `GENERATION_PROVIDER=mock` instead also boots).

Rough cost if torn down the same day: under $1 (basic-xxs $5/mo +
Spaces $5/mo, both billed hourly; Atlas M0 is free).

## 1. MongoDB Atlas

1. Create a free **M0** cluster (Atlas UI → Build a Database), region
   near the app (e.g. AWS `us-east-1` for DO `nyc`).
2. Under **Database Access**, add a database user with a password.
3. Under **Network Access**, add `0.0.0.0/0` for now (open to any IP);
   lock it to the app's outbound IPs in step 4.
4. From **Connect → Drivers**, copy the `mongodb+srv://` string, insert
   the user's password, and set the database path to `/slide-machine`.
   This becomes the `MONGODB_URI` secret.

## 2. Spaces (S3-compatible uploads)

Seed-material uploads go through the `s3` storage adapter
([server/src/storage/index.ts](../server/src/storage/index.ts)), which
writes objects with a `public-read` ACL and serves them from
`S3_PUBLIC_BASE_URL`.

1. Create a bucket: dashboard → Spaces → Create, same region (`nyc3`),
   e.g. `slide-machine-dry`. Enable the **CDN**.
2. Create a **Spaces access key** (API → Spaces Keys). Note key + secret.
3. The env values these produce (names match `server/.env.example`):

   | Variable | Value |
   | --- | --- |
   | `STORAGE_PROVIDER` | `s3` |
   | `S3_ENDPOINT` | `https://nyc3.digitaloceanspaces.com` |
   | `S3_REGION` | `nyc3` |
   | `S3_BUCKET` | `slide-machine-dry` |
   | `S3_FORCE_PATH_STYLE` | `false` (Spaces is vhost-style; `true` is MinIO-only) |
   | `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | the Spaces key pair |
   | `S3_PUBLIC_BASE_URL` | `https://slide-machine-dry.nyc3.cdn.digitaloceanspaces.com` |

## 3. The app

1. Copy the spec — do not edit the tracked one:
   `cp .do/app.yaml /tmp/app-dry-run.yaml`, then in the copy:
   - `name: slide-machine-dry`
   - `github.branch:` the branch under test; `deploy_on_push: false`
   - Uncomment `GEMINI_API_KEY` and all seven `S3_*`/storage keys; add
     `STORAGE_PROVIDER: s3` as a plain env.
2. `doctl apps create --spec /tmp/app-dry-run.yaml`
3. In the dashboard (app → Settings → the `web` component →
   Environment Variables) fill in the secrets: `MONGODB_URI` (step 1),
   `JWT_SECRET` and `JWT_REFRESH_SECRET` (`openssl rand -base64 48`
   each; min 32 chars), `GEMINI_API_KEY`, and the step-2 values. For
   real-time speech, also set `GOOGLE_APPLICATION_CREDENTIALS_JSON` to
   the full service-account key JSON (the key **file** is gitignored and
   never reaches the container, so the file-path var will not work here).
4. Optionally tighten Atlas **Network Access**: replace `0.0.0.0/0`
   with the app's outbound IPs (dashboard → app → Settings → dedicated
   egress IPs, if enabled).
5. Trigger a deploy: `doctl apps create-deployment <app-id>`. The
   Dockerfile multi-stage build runs; the container passes the
   `/api/health` health check on port 3000 when it's up.

## 4. Sign-in and Google OAuth (optional)

The verify steps below only need an email/password account, which works
with no extra setup. Do this section only to also test Google sign-in.

Google's redirect URI must match a value registered in the OAuth client
byte-for-byte, and the server builds it from `PUBLIC_BASE_URL`
([server/src/auth/google.ts](../server/src/auth/google.ts)) — which you
only know once the app has a URL. So this is a set-then-redeploy step:

1. Note the app's URL from step 3, e.g.
   `https://slide-machine-dry-xxxxx.ondigitalocean.app`.
2. In the `web` component's Environment Variables set `PUBLIC_BASE_URL`
   to that origin (https, no trailing slash), and fill in
   `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` from your
   Google Cloud OAuth client.
3. In that OAuth client (Google Cloud Console → Credentials), add
   `<origin>/api/auth/google/callback` as an **Authorized redirect URI**.
4. Redeploy so the new `PUBLIC_BASE_URL` takes effect:
   `doctl apps create-deployment <app-id>`.

Skip it and the app still boots — email/password sign-in works — but the
Google button fails the redirect-URI match.

## 5. Verify the core loop

At the app's `ondigitalocean.app` URL, in order:

1. `/api/health` reports `"status": "ok", "mongo": "connected"` — the
   endpoint returns 200 even when Mongo is down (by design, to avoid
   flapping the platform health check), so read the body, not the code.
2. Register an account (or use Google sign-in if step 4 is set up);
   reload — the session survives (JWT + refresh). A signed-in session is
   required before the Speak flow works.
3. Create a project, start a lecture, and speak (Chrome mic, or the
   typed Speak bar): coherent Gemini slides appear in ~1s per phrase.
4. In lecture settings, upload a seed image. Confirm the object landed
   in the Spaces bucket and the slide/settings thumbnail loads from the
   `cdn.digitaloceanspaces.com` URL (public-read ACL working).
5. Open the deck permalink in a private window (logged out) — public
   decks render read-only.
6. Skim runtime logs (`doctl apps logs <app-id> --type run`) for errors.

## 6. Teardown

```sh
doctl apps delete <app-id>
```

Delete the Atlas cluster (Atlas UI → cluster → Terminate), and the
Space plus the Spaces key in the DO dashboard (no `doctl` for Spaces).
Nothing above touches the tracked spec, so production wiring (`master`,
deploy-on-push) is unchanged.

## Promoting to the real deployment

When the dry run passes, the same values go into the real app created
from the tracked [.do/app.yaml](../.do/app.yaml) — fresh secrets, a
non-`dry` bucket and cluster, and `deploy_on_push: true` on `master`.
