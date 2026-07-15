# Image enrichment

Image enrichment ([IMG-1](SPEC.md#img-1-real-time-image-enrichment)) puts a
relevant illustration on a slide without the instructor picking one. It runs
in the background, off the phrase→slide critical path: once a slide's text
exists, the system searches CC-licensed image providers for the slide's
keywords, ranks what comes back, and — if anything clears the bar — attaches
the best match. It never blocks slide generation and never overwrites an
image already on a slide.

## How candidates are scored

All providers are queried in parallel and their results pooled, then
`pickBest` (`server/src/enrichment/scoring.ts`) picks a single winner:

- **Relevance** — the fraction of the slide's keywords found in a candidate's
  title and tags. Zero keyword overlap scores zero; nothing else can rescue it.
- **Source prior** — relevance is weighted by how much we trust each source.
  The instructor's own seeded images (`1.2`) beat any web source; among web
  sources Wikimedia (`1.0`) leads for named entities and concepts, then
  Openverse (`0.9`), then Flickr (`0.85`) — prettiest but noisiest.
- **Size** — candidates under 320px wide are dropped (won't survive a
  projector); ≥600px adds a small bonus.
- **Threshold** — the top candidate must score at least `0.3` or no image is
  used at all. A missing image beats a misleading one.

The rest of this document covers the provider accounts and keys.

Two providers are keyless; only Flickr needs an account and API key, and it
is optional — without a key the pipeline simply runs on the other two.

| Provider          | Account/key needed | Env var          |
| ----------------- | ------------------ | ---------------- |
| Wikimedia Commons | none               | —                |
| Openverse         | none               | —                |
| Flickr            | optional API key   | `FLICKR_API_KEY` |

This covers image *search* only. Image *generation* uses Gemini
(`IMAGE_GEN_PROVIDER`) — see [GOOGLE_API_KEYS.md](GOOGLE_API_KEYS.md).

## 1. Wikimedia Commons — nothing to do

Public MediaWiki API, no account or key. Subject to Wikimedia's general
API etiquette (reasonable request rates); the enrichment pipeline's small
per-slide request volume is well within it.

## 2. Openverse — nothing to do

Public API, no key. Anonymous access is rate-limited; if we ever hit those
limits, Openverse offers higher limits via free OAuth2 registration
(<https://api.openverse.org/v1/#tag/auth>), but the app currently calls it
keyless and has no auth support wired in.

## 3. Flickr key (`FLICKR_API_KEY`)

To keep the key independent of any personal account, create it under a
dedicated Flickr account (same principle as the dedicated Google account
in [GOOGLE_API_KEYS.md](GOOGLE_API_KEYS.md)).

1. Create the account at <https://www.flickr.com/sign-up> (a Flickr
   account; no paid Pro plan needed).
2. Go to <https://www.flickr.com/services/apps/create/> and choose
   **Apply for a Non-Commercial Key** (instant approval; a Commercial Key
   requires review — revisit if the product charges users for this feature).
3. Name the app (e.g. `slide-machine`), describe it briefly, accept the
   terms, and submit. You get a **Key** and a **Secret**.
4. Copy the **Key** only. The Secret is for authenticated/signed calls;
   our search (`flickr.photos.search`) is key-only, so the Secret is never
   used — no need to store it outside the Flickr apps page.

Keys are listed and revocable at <https://www.flickr.com/services/apps/>
under the account that created them (no team sharing — access to manage
the key means access to the dedicated account). Rate limit is 3600
queries/hour per key.

## 4. Wire into the app

In `server/.env` (see [server/.env.example](../server/.env.example)):

```bash
IMAGE_ENRICHMENT_ENABLED=true
FLICKR_API_KEY=<key from step 3>   # optional; blank = Wikimedia + Openverse only
```

Restart the server. Provider failures (including a bad key) return no
candidates rather than erroring — so verify the key works by checking
that Flickr-attributed images appear among enrichment candidates, not by
waiting for an error.

## 5. Housekeeping

- Never commit keys; `.env` is gitignored. In Docker/DigitalOcean, set
  `FLICKR_API_KEY` as an environment variable or platform secret.
- Rotate by creating a new app/key on the Flickr apps page, deploying it,
  then deleting the old app.
