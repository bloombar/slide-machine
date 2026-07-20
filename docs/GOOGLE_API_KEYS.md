# Google credentials (Gemini + Cloud Speech-to-Text + Cloud Text-to-Speech + Cloud Translation + Forms/Drive OAuth)

The server reads its Google credentials from `server/.env` (see
[server/.env.example](../server/.env.example)):

- `GEMINI_API_KEY` — Gemini API (slide generation, quiz-question drafting, images)
- `GOOGLE_APPLICATION_CREDENTIALS` — service-account JSON, for real-time
  Speech-to-Text streaming (§3); optional — only when using Google STT
- `GOOGLE_CLOUD_TRANSLATION_KEY` — Cloud Translation (on-demand deck
  translation, [SHARE-2](SPEC.md#share-2-post-lecture-translated-viewing))
- `GOOGLE_CLOUD_TTS_KEY` — Cloud Text-to-Speech (spoken slide/deck playback,
  §5). Optional — without it, the play button and per-slide "Speak this
  slide" simply don't appear
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` — OAuth client for
  Google sign-in (AUTH-1) and connected-account Drive/Forms access used by
  quiz publishing (EXP-4); see §6

Live transcription is optional — the app ships with a keyless browser engine
(§3). Gemini and Translation use plain API keys; real-time STT uses a
service-account JSON (§3). To keep credentials independent of any personal
account, create them inside a dedicated Google Cloud project owned by a
dedicated Google account (e.g. a `slide-machine-ops@...` account or your org's
Workspace), never a personal one.

## 1. One-time project setup

1. Sign in to <https://console.cloud.google.com> as the dedicated account.
2. Project picker (top bar) → **New Project** → name it `slide-machine`
   (or `slide-machine-prod`) → **Create**, then select it.
3. Attach billing: <https://console.cloud.google.com/billing> →
   **Link a billing account**. STT has no keyless free tier; Gemini works
   unbilled at free-tier rate limits but needs billing for production quotas.
4. Enable all four APIs at **APIs & Services → Library** (with the project
   selected), searching for and enabling:
   - **Generative Language API** (this is the Gemini API)
   - **Cloud Speech-to-Text API**
   - **Cloud Text-to-Speech API**
   - **Cloud Translation API**

## 2. Gemini key (`GEMINI_API_KEY`)

1. Go to <https://aistudio.google.com/apikey> signed in as the same account.
2. **Create API key** → **Create API key in existing project** → pick the
   `slide-machine` project. Copy the key once — treat it as a secret.
3. Optional but recommended: in **Cloud Console → APIs & Services →
   Credentials**, edit the key → **API restrictions → Restrict key** →
   select only *Generative Language API* → **Save**.

(Equivalently you can mint the key directly in Cloud Console → Credentials →
**Create credentials → API key**; AI Studio is just Google's canonical route
and shows Gemini usage/quota in one place.)

## 3. Speech-to-Text: choose an engine

Live lecture transcription has two interchangeable engines. The speech UI is
identical either way, and the choice is a **single server variable** —
`TRANSCRIPTION_PROVIDER` in `server/.env` — which the client learns at boot via
`GET /api/config`. Flip it and restart the server; no client rebuild.

- **`browser`** (default) — the Chrome/Edge/Safari Web Speech API. No Google
  credential, no billing, nothing to set up here; the browser handles the
  audio. Tradeoff: quality and language coverage vary by browser, and it only
  runs in browsers that ship the API.
- **`google-cloud`** — the browser streams mic audio to the server over a
  WebSocket; the server relays it to Google Cloud Speech-to-Text's real-time
  `streamingRecognize` and streams transcripts back. Consistent quality, full
  language list, works in any browser — but billed per usage and needs the
  service-account credential below.
- **`none`** — capture disabled; only the typed Speak bar remains.

```bash
# server/.env
TRANSCRIPTION_PROVIDER=google-cloud   # or: browser | none
```

Real-time streaming is gRPC-only and **rejects API keys**, so it authenticates
with a service-account JSON key. Cloud STT has no keyless free tier — the
project's billing account covers it (billed per minute of audio, with a
monthly free allotment).

### Create the service account (`GOOGLE_APPLICATION_CREDENTIALS`)

1. **Cloud Console → IAM & Admin → Service Accounts** (same project) →
   **+ Create service account**.
2. Name it `slide-machine-stt` → **Create and continue**.
3. Grant the role **Cloud Speech Client** (`roles/speech.client`) — the
   least-privilege role for calling Speech-to-Text → **Continue → Done**.
4. Open the new service account → **Keys → Add key → Create new key → JSON**
   → **Create**. The JSON downloads once; treat it as a secret — it grants
   API access without a password.
5. Store it and point the server at it in `server/.env`. A bare filename
   resolves against the `server/` directory; an absolute path works anywhere:

   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=service-account.json
   ```

   On hosts with no key file (e.g. DigitalOcean App Platform), skip the file
   and set `GOOGLE_APPLICATION_CREDENTIALS_JSON` to the whole key JSON as a
   platform secret instead — it takes precedence and is loaded in memory.

### Post-lecture diarization: a GCS bucket (Phase 3, GEN-4)

Real-time streaming **can't** diarize (identify who spoke), so speaker
attribution runs **after** the lecture as a Cloud Speech-to-Text **v2
`BatchRecognize`** job (Chirp 3, `SpeakerDiarizationConfig`). That API reads its
input audio from — and writes its results to — **Google Cloud Storage (`gs://`)
only**, so a bucket is required. It reuses the **same `slide-machine-stt`
service account** from above; no new key.

This is only needed once you turn on Phase 3 (it is **not** used by Phase 2
audio retention, which stores WAVs in your existing S3/Spaces bucket). You can
provision it now to unblock that work:

1. **Enable the Cloud Storage API**: Console → **APIs & Services → Library**
   (same project) → search **Cloud Storage API** → **Enable**. (The
   Speech-to-Text API enabled in §1 already covers the v2 batch calls.)
2. **Create a private bucket**: Console → **Cloud Storage → Buckets → Create**.
   Name it e.g. `slide-machine-audio` (globally unique — prefix with the
   project if taken). **Keep it private** — it holds raw lecture audio with
   student voices, so do NOT enable public access (unlike the Spaces image
   bucket). A single-region location in/near your users is fine; confirm the
   region supports Chirp 3 batch diarization when we wire the call (US regions
   are the safe default).
3. **Grant the service account access**: bucket → **Permissions → Grant
   access** → principal = `slide-machine-stt@<project>.iam.gserviceaccount.com`
   → role **Storage Object Admin** (`roles/storage.objectAdmin`). It needs to
   upload the input WAV and read the batch output on the same bucket.
4. **(Deployed hosts)** No extra credential — the batch client authenticates
   with the same `GOOGLE_APPLICATION_CREDENTIALS[_JSON]` service account.

That's all you need to do. When Phase 3 lands it will add a
`GCS_AUDIO_BUCKET=<bucket-name>` variable to `server/.env` (and the deploy env),
copy each retained recording to `gs://<bucket>/…`, run the diarization job, and
delete the copy afterward. Lifecycle/retention for this bucket follows the same
`AUDIO_RETENTION_DAYS` policy as the S3 audio (see docs/DEPLOY.md).

## 4. Translation key (`GOOGLE_CLOUD_TRANSLATION_KEY`)

An API key (unlike STT streaming, translation is a plain REST call):

1. **Cloud Console → APIs & Services → Credentials** (same project) →
   **+ Create credentials → API key**. Copy the key.
2. Edit the key → rename it `slide-machine-translation` → **API
   restrictions → Restrict key** → select only *Cloud Translation API* →
   **Save**.

Cloud Translation has no keyless free tier — the project's billing account
covers it (Basic v2 is billed per character, with a monthly free allotment;
see the current pricing page).

### Text-to-Speech key (`GOOGLE_CLOUD_TTS_KEY`)

Another plain-REST API key, exactly like Translation (Cloud Text-to-Speech
does **not** use the STT service account):

1. **Cloud Console → APIs & Services → Credentials** (same project) →
   **+ Create credentials → API key**. Copy the key.
2. Edit the key → rename it `slide-machine-tts` → **API restrictions →
   Restrict key** → select only *Cloud Text-to-Speech API* → **Save**.

Billed per character with a monthly free allotment (see the pricing page).
Without this key the TTS feature is disabled end-to-end: the client's
`/api/config` reports it off, so the play button and the per-slide "Speak this
slide" option are not shown, and nothing else in the app is affected.
`TTS_PROVIDER=none` disables it explicitly; `mock` is for tests.

Keep the keys separate (one per API) so any one can be rotated or
revoked without touching the others.

## 5. Wire into the app

In `server/.env`:

```bash
GEMINI_API_KEY=<key from step 2>
GOOGLE_CLOUD_TRANSLATION_KEY=<key from step 4>
GOOGLE_CLOUD_TTS_KEY=<key from the Text-to-Speech step in §4>
GENERATION_PROVIDER=gemini   # switch off the mock once the key exists

# Live transcription (§3): one flip switches the whole app.
#  • browser (default): no credential needed
#  • google-cloud: real-time streaming, plus the service account from §3
TRANSCRIPTION_PROVIDER=google-cloud
GOOGLE_APPLICATION_CREDENTIALS=service-account.json

# Spoken playback. Feature auto-enables when GOOGLE_CLOUD_TTS_KEY is set.
TTS_PROVIDER=google-cloud   # or: none
# TTS_LANGUAGE=en-US         # deck/project language overrides this per request
TTS_DEFAULT_VOICE=nova       # default catalog voice; blank = provider default
```

Restart the server; config is validated at boot by `server/src/config/env.ts`.

## 6. Google Forms & Drive access for quiz publishing (EXP-4 connected accounts)

Quiz publishing ([SPEC §17](SPEC.md#17-quiz-generator-integration)) creates a Google Form **in the instructor's own Drive**, so it does not use the ops account's API keys above. Instead it acts as the **instructor**, through the per-user Google account they connect ([EXP-4](SPEC.md#exp-4-connected-accounts-google-drive--github)) — the same OAuth client as Google sign-in, but with **broader scopes** and offline access.

### Enable the APIs

In the same Cloud project (§1), **APIs & Services → Library**, enable:

- **Google Forms API**
- **Google Drive API**

### Scopes to request on the connect flow

The connected-account consent must request these least-privilege scopes — they match what the imported Quiz Generator library uses (`src/lib/google-auth.ts` in that repo):

| Scope                                            | Why                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `https://www.googleapis.com/auth/forms.body`     | Create and edit the quiz form's questions, settings, and metadata           |
| `https://www.googleapis.com/auth/forms.body.readonly` | Read a form back (download / update flows)                             |
| `https://www.googleapis.com/auth/drive.file`     | Place the created form into a chosen Drive folder — per-file access, limited to files this app creates |

These are **separate from the Google sign-in scopes** (`openid`, `email`, `profile`) requested in [server/src/auth/google.ts](../server/src/auth/google.ts). Sign-in identifies the user; **connecting** a Google account for publishing is a second, broader consent (AUTH-1 vs EXP-4), and a user who signed in by email/GitHub can still connect Google here.

### Offline access (refresh token)

To publish later without the instructor present, the connect flow must obtain a **refresh token**: build the Google OAuth URL with **`access_type=offline`** and **`prompt=consent`** (the sign-in flow deliberately does not). The refresh token is stored **encrypted at rest** (`CONNECTED_ACCOUNT_TOKEN_ENC_KEY`, [P-9](SPEC.md#16-privacy-security--compliance)); at publish time the server builds an authorized client from it and injects it into the Quiz Generator library ([QUIZ-4](SPEC.md#quiz-4-delegated-google-access)).

### OAuth consent screen

`drive.file` and `forms.body` are **sensitive scopes**. While the OAuth consent screen is in **Testing**, add each pilot instructor as a **test user**; a published *external* consent screen using these scopes can require Google verification. For a single-institution pilot, scoping the OAuth client to the **NYU Workspace** organization and keeping instructors as known users avoids the public-verification path.

## 7. Share the project with coworkers

Access is granted per Google account via IAM — coworkers sign in with their
own accounts; never share the dedicated account's password.

1. **Cloud Console → IAM & Admin → IAM** (with the `slide-machine` project
   selected) → **Grant access**.
2. Under **New principals**, enter the coworker's Google account email.
3. Assign a role:
   - **Owner** (`roles/owner`) — full administrator: manage APIs, keys,
     IAM, and project settings. Use for co-administrators you fully trust.
   - **Editor** (`roles/editor`) — can manage APIs and keys but not IAM;
     a good default for most collaborators.
4. **Save**. For projects outside a Workspace organization, an Owner grant
   sends an email invitation the coworker must accept before it takes effect.

Notes:

- Anyone with Owner/Editor can view and regenerate all three API keys under
  **APIs & Services → Credentials**, and Gemini keys at
  <https://aistudio.google.com/apikey> once they select this project.
- Billing is controlled separately: to let a coworker manage the billing
  account, add them at **Billing → Account management → Add principal**
  with the *Billing Account Administrator* role.
- To revoke access, remove the principal on the same IAM page.

## 8. Housekeeping

- Never commit keys; `.env` is gitignored. In Docker/DigitalOcean, set them
  as environment variables or platform secrets instead.
- Rotate: create a replacement key, deploy it, then delete the old one in
  **Credentials** (deletion is immediate and irreversible).
- Set a billing budget alert (<https://console.cloud.google.com/billing> →
  **Budgets & alerts**) so runaway usage pages you before the invoice does.
- Monitor per-API usage under **APIs & Services → Dashboard**.
