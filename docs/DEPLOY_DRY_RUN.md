# Deployment dry-run: DO App Platform + Spaces + Managed MongoDB

Proves the Phase 1 exit criterion — "the core loop runs on DO for one
user" (see [ROADMAP §5](ROADMAP.md)) — without touching the production
wiring in [.do/app.yaml](../.do/app.yaml), which auto-deploys `master`.
Everything below is disposable; teardown is the last step.

## What you need

- A DigitalOcean account with billing enabled, and `doctl` authed
  (`doctl auth init`) — or use the dashboard for every `doctl` step.
- The DigitalOcean GitHub app granted access to `bloombar/slide-machine`
  (dashboard → Settings → GitHub, or you'll be prompted on app create).
- The `GEMINI_API_KEY` from `server/.env` (real generation is part of
  the point; setting `GENERATION_PROVIDER=mock` instead also boots).

Rough cost if torn down the same day: under $1 (basic-xxs $5/mo +
smallest MongoDB ~$15/mo + Spaces $5/mo, all billed hourly).

## 1. Managed MongoDB

1. Create the smallest MongoDB cluster in the app's region:
   `doctl databases create slide-machine-dry --engine mongodb --region nyc1 --size db-s-1vcpu-1gb --num-nodes 1`
2. From the cluster's **Connection details**, copy the `mongodb+srv://`
   string and change the database path from `/admin` to
   `/slide-machine` (keep `authSource=admin&tls=true...` as given).
   This becomes the `MONGODB_URI` secret. If the driver rejects TLS,
   download the cluster's CA certificate from the same panel.
3. Leave **Trusted sources** open for now; lock it to the app in step 4.

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
   each; min 32 chars), `GEMINI_API_KEY`, and the step-2 values.
4. Back on the database cluster, add the app as a **Trusted source**.
5. Trigger a deploy: `doctl apps create-deployment <app-id>`. The
   Dockerfile multi-stage build runs; the container passes the
   `/api/health` health check on port 3000 when it's up.

## 4. Verify the core loop

At the app's `ondigitalocean.app` URL, in order:

1. `/api/health` reports `"status": "ok", "mongo": "connected"` — the
   endpoint returns 200 even when Mongo is down (by design, to avoid
   flapping the platform health check), so read the body, not the code.
2. Register an account; reload — the session survives (JWT + refresh).
3. Create a project, start a lecture, and speak (Chrome mic, or the
   typed Speak bar): coherent Gemini slides appear in ~1s per phrase.
4. In lecture settings, upload a seed image. Confirm the object landed
   in the Spaces bucket and the slide/settings thumbnail loads from the
   `cdn.digitaloceanspaces.com` URL (public-read ACL working).
5. Open the deck permalink in a private window (logged out) — public
   decks render read-only.
6. Skim runtime logs (`doctl apps logs <app-id> --type run`) for errors.

## 5. Teardown

```sh
doctl apps delete <app-id>
doctl databases delete <db-id>
```

Delete the Space and the Spaces key in the dashboard (no `doctl` for
Spaces). Nothing above touches the tracked spec, so production wiring
(`master`, deploy-on-push) is unchanged.

## Promoting to the real deployment

When the dry run passes, the same values go into the real app created
from the tracked [.do/app.yaml](../.do/app.yaml) — fresh secrets, a
non-`dry` bucket and cluster, and `deploy_on_push: true` on `master`.
