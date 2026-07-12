# Google API keys (Gemini + Cloud Speech-to-Text + Cloud Translation)

The server reads three Google credentials from `server/.env` (see
[server/.env.example](../server/.env.example)):

- `GEMINI_API_KEY` — Gemini API (generation, quizzes, images)
- `GOOGLE_CLOUD_STT_KEY` — Cloud Speech-to-Text (live transcription)
- `GOOGLE_CLOUD_TRANSLATION_KEY` — Cloud Translation (on-demand deck
  translation, SHARE-2)

All are plain API keys, not service-account JSON. To keep them independent
of any personal account, create them inside a dedicated Google Cloud project
owned by a dedicated Google account (e.g. a `slide-machine-ops@...` account
or your org's Workspace), never a personal one.

## 1. One-time project setup

1. Sign in to <https://console.cloud.google.com> as the dedicated account.
2. Project picker (top bar) → **New Project** → name it `slide-machine`
   (or `slide-machine-prod`) → **Create**, then select it.
3. Attach billing: <https://console.cloud.google.com/billing> →
   **Link a billing account**. STT has no keyless free tier; Gemini works
   unbilled at free-tier rate limits but needs billing for production quotas.
4. Enable all three APIs at **APIs & Services → Library** (with the project
   selected), searching for and enabling:
   - **Generative Language API** (this is the Gemini API)
   - **Cloud Speech-to-Text API**
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

## 3. Speech-to-Text key (`GOOGLE_CLOUD_STT_KEY`)

1. **Cloud Console → APIs & Services → Credentials** (same project) →
   **+ Create credentials → API key**. Copy the key.
2. Edit the key → rename it `slide-machine-stt` → **API restrictions →
   Restrict key** → select only *Cloud Speech-to-Text API* → **Save**.

## 4. Translation key (`GOOGLE_CLOUD_TRANSLATION_KEY`)

Same procedure as the STT key:

1. **Cloud Console → APIs & Services → Credentials** (same project) →
   **+ Create credentials → API key**. Copy the key.
2. Edit the key → rename it `slide-machine-translation` → **API
   restrictions → Restrict key** → select only *Cloud Translation API* →
   **Save**.

Like STT, Cloud Translation has no keyless free tier — the project's
billing account covers it (Basic v2 is billed per character, with a
monthly free allotment; see the current pricing page).

Keep the keys separate (one per API) so any one can be rotated or
revoked without touching the others.

## 5. Wire into the app

In `server/.env`:

```bash
GEMINI_API_KEY=<key from step 2>
GOOGLE_CLOUD_STT_KEY=<key from step 3>
GOOGLE_CLOUD_TRANSLATION_KEY=<key from step 4>
GENERATION_PROVIDER=gemini   # switch off the mock once the key exists
```

Restart the server; config is validated at boot by `server/src/config/env.ts`.

## 6. Share the project with coworkers

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

## 7. Housekeeping

- Never commit keys; `.env` is gitignored. In Docker/DigitalOcean, set them
  as environment variables or platform secrets instead.
- Rotate: create a replacement key, deploy it, then delete the old one in
  **Credentials** (deletion is immediate and irreversible).
- Set a billing budget alert (<https://console.cloud.google.com/billing> →
  **Budgets & alerts**) so runaway usage pages you before the invoice does.
- Monitor per-API usage under **APIs & Services → Dashboard**.
