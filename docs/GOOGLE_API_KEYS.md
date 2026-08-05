# Google credentials (Gemini + Cloud Speech-to-Text + Cloud Text-to-Speech + Cloud Translation + Forms/Drive/Slides OAuth)

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
  Google sign-in (AUTH-1) and connected-account Drive/Forms/Slides access used
  by quiz publishing, export, and template/lecture import (EXP-4); see §6

**Connected-account features need no API key of their own.** Quiz publishing,
Drive export, and Google Slides import all act *as the instructor* through the
OAuth client above, not through the ops account's keys. Adding them changes §6
only — there is no "Slides API key" to create.

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

Then turn it on in `server/.env` (and the deploy env):

```bash
# server/.env
DIARIZATION_PROVIDER=google-cloud    # 'none' (default) | 'mock' (tests)
GCS_AUDIO_BUCKET=slide-machine-audio # the bucket you created above
DIARIZATION_LOCATION=us              # Chirp 3 is ONLY in the 'us' / 'eu' multi-regions
```

**Location matters:** Chirp 3 exists only in the **`us`** and **`eu`**
multi-regions — a regional endpoint like `us-central1` or `us-east1` fails with
`model "chirp_3" does not exist in the location`. A US *regional* bucket (e.g.
`us-east1`) is fine to read from the `us` multi-region recognizer.

The diarization pass (`deck.diarize`) then copies each retained recording to
`gs://<bucket>/diarize/…`, runs a v2 `BatchRecognize` Chirp 3 job with speaker
diarization + word time offsets, tags the transcript segments with speaker +
lecturer/student role, and deletes the GCS copy. It reuses the same service
account — no extra key. (Validated live: a batch job on ~23 s of two-speaker
audio separated the speakers correctly in ~30 s.)

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

# Google Slides import (§6). `mock` needs no Google setup at all and is what
# the test suite runs under; `live` requires the connected-account scopes below.
IMPORT_MODE=mock             # or: live
```

Restart the server; config is validated at boot by `server/src/config/env.ts`.

## 6. Connected-account access: Forms, Drive & Slides (EXP-4)

Three features act **as the instructor** rather than as the ops account, through the per-user Google account they connect ([EXP-4](SPEC.md#exp-4-connected-accounts-google-drive--github)) — the same OAuth client as Google sign-in, but with **broader scopes** and offline access:

- **Quiz publishing** ([SPEC §17](SPEC.md#17-quiz-generator-integration)) — creates a Google Form in the instructor's own Drive.
- **Export** ([EXP-1](SPEC.md#exp-1-deck-export)/[EXP-6](SPEC.md#exp-6-template-export-to-google-slides)) — writes decks and templates into their Drive.
- **Import** ([TMPL-8](SPEC.md#tmpl-8-template-import-from-google-slides)/[EXP-5](SPEC.md#exp-5-lecture-import-from-google-slides)) — reads their existing Google Slides presentations to derive a template or a lecture.

One OAuth client, one stored authorization, three consumers. None of them uses an API key.

### Enable the APIs

In the same Cloud project (§1), **APIs & Services → Library**, enable:

- **Google Forms API**
- **Google Drive API**
- **Google Slides API** — *needed only for import; see the release note below*

### Scopes to request on the connect flow

The connected-account consent must request these least-privilege scopes:

| Scope | Why |
| --- | --- |
| `https://www.googleapis.com/auth/forms.body` | Create and edit the quiz form's questions, settings, and metadata |
| `https://www.googleapis.com/auth/forms.body.readonly` | Read a form back (download / update flows) |
| `https://www.googleapis.com/auth/drive.file` | Place the created form into a chosen Drive folder, and write exports — per-file access, limited to files this app creates |
| `https://www.googleapis.com/auth/drive.readonly` | Browse and read files the app did **not** create — the import picker listing the instructor's own presentations |
| `https://www.googleapis.com/auth/presentations.readonly` | Read a presentation's layouts, element geometry and theme to derive a template. Read-only: import never writes to the instructor's Slides — *see the release note below* |

The first four are requested today. `presentations.readonly` and the Slides API arrive with Google Slides import; granting them before that ships is harmless but does nothing.

Note that **exporting** a template to Google Slides needs no Slides scope — the file is produced as a `.pptx` and converted by Drive, which `drive.file` already covers. Only reading someone's existing presentation needs the new scope.

These are all **separate from the Google sign-in scopes** (`openid`, `email`, `profile`) requested in [server/src/auth/google.ts](../server/src/auth/google.ts). Sign-in identifies the user; **connecting** a Google account is a second, broader consent (AUTH-1 vs EXP-4), and a user who signed in by email/GitHub can still connect Google here.

### Configure the scopes in the console

Requesting a scope in code is only half of it — it must also be declared on the consent screen.

1. **Enable the scope's API first** (the section above). A scope does **not** appear in the picker until its API is enabled on the project, which is the usual reason people can't find one.
2. **APIs & Services → OAuth consent screen.** Google moved this to **Google Auth Platform** during 2025, so you may land on a page with **Branding / Audience / Clients / Data Access** tabs instead. Same thing — if you're searching for "OAuth consent screen" and not finding it, that's why.
3. Open **Data Access** (older UI: the "Scopes" step of the consent wizard) → **Add or remove scopes**.
4. Filter by the API name or the scope string, tick the scope, **Update**, then **Save**.

Take the **Sensitive / Restricted** label the picker shows next to each scope as authoritative — it decides your verification path below, and Google reclassifies scopes from time to time.

### What you don't need to change

Adding a connected-account scope touches the two places above and nothing else. In particular:

- **No new OAuth client**, and no change to `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`.
- **No redirect URI change.** The connect flow deliberately reuses the already-registered sign-in callback `/api/auth/google/callback` rather than a dedicated one ([google-connect.ts](../server/src/auth/google-connect.ts)).
- **No API key.** Connected-account features authenticate as the instructor.
- **No service-account or billing change** — those are Speech-to-Text concerns (§3).
- **Do not rotate `CONNECTED_ACCOUNT_TOKEN_ENC_KEY`.** It is unrelated, and rotating it orphans every existing connection.

### Adding a scope forces a one-time reconnect

A stored refresh token carries **only the scopes granted when it was issued**. Adding a scope therefore does nothing for accounts that connected earlier — they keep working for whatever they were already authorized to do, and the new feature fails for them until they reconnect.

This is handled, not left to chance:

- The consent URL sends `include_granted_scopes=true`, so reconnecting is **additive** — an instructor never loses a grant by re-consenting.
- The server checks the stored grant before attempting a scoped call, and the UI **prompts the instructor to reconnect** rather than failing with an opaque error.

Expect this whenever a scope is added, not just this once. If you are rolling out to an existing cohort, tell them to expect a single reconnect prompt.

**Granted is not the same as requested.** The consent screen lets a user untick individual permissions, so someone can reconnect and still not hold the scope. That is why the server records the scopes Google actually granted and checks them, rather than assuming the request succeeded.

To confirm what an account really holds, open <https://myaccount.google.com/connections>, find the app, and read its permission list. The Cloud Console tells you what is *requested*; this tells you what was *granted*.

### Offline access (refresh token)

To publish later without the instructor present, the connect flow must obtain a **refresh token**: build the Google OAuth URL with **`access_type=offline`** and **`prompt=consent`** (the sign-in flow deliberately does not). The refresh token is stored **encrypted at rest** (`CONNECTED_ACCOUNT_TOKEN_ENC_KEY`, [P-9](SPEC.md#16-privacy-security--compliance)); at publish time the server builds an authorized client from it and injects it into the Quiz Generator library ([QUIZ-4](SPEC.md#quiz-4-delegated-google-access)).

### Encryption key for stored tokens (`CONNECTED_ACCOUNT_TOKEN_ENC_KEY`)

This is **not** a Google credential — it is the app's own AES-256-GCM key ([server/src/lib/token-crypto.ts](../server/src/lib/token-crypto.ts)) that encrypts the refresh token above before it is written to the database. You generate it yourself; live quiz publishing (`QUIZ_PUBLISH_MODE=live`) needs it set.

It must be **32 random bytes, base64-encoded** (a 44-character string ending in `=`) — anything else fails validation at first use. Generate one with either:

```bash
openssl rand -base64 32
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Paste the output into `CONNECTED_ACCOUNT_TOKEN_ENC_KEY` in `server/.env`. **Keep it stable:** tokens encrypted under one key can't be decrypted under another, so rotating it orphans every already-connected account (users must reconnect). A blank/unset key is fine until the first account is connected.

### OAuth consent screen & verification

Google grades scopes in three tiers, and ours are not all the same tier:

| Tier | Ours | Consequence for a **published external** app |
| --- | --- | --- |
| Basic | `openid`, `email`, `profile` (sign-in) | None. |
| **Sensitive** | `forms.body`, `forms.body.readonly`, `drive.file`, `presentations.readonly` | Verification review by Google. |
| **Restricted** | `drive.readonly` | Verification **plus** an annual third-party security assessment. |

`drive.readonly` being *restricted* is the one to know about: it is already requested today, so this constraint is live now rather than something Google Slides import introduces. It is also the strongest reason to keep the client Workspace-internal.

**Decide your audience mode before adding any scope** (**Google Auth Platform → Audience**):

| Mode | What adding a scope costs you |
| --- | --- |
| **Internal** (Workspace org) | Nothing. Sensitive and restricted scopes need no verification at all. **Preferred for a single-institution pilot.** |
| **External + Testing** | Nothing, as long as every instructor is listed under **Audience → Test users** (100 max). |
| **External + Published** | Re-triggers verification — weeks, with the feature blocked meanwhile, and a security assessment if any restricted scope is involved. |

So: **add scopes before publishing, never after.** If the OAuth client can be scoped to the **NYU Workspace** organization as Internal, do that — it removes the entire verification path, for these scopes and any future ones.

### Quotas

Slides and Drive reads are quota'd per Cloud project, not per user. One template or lecture import is a single presentation read plus one fetch per image it copies, so the default quotas are ample — a cohort importing on the same afternoon is nowhere near them. Worth knowing before diagnosing a failed import as a quota problem: it almost certainly isn't.

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
