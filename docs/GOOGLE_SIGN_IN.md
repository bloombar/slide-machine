# Enabling Google Sign-in (AUTH-1)

How to obtain the OAuth 2.0 credentials that let users register and log in
with a Google account — including **NYU Workspace** accounts — and wire them
into the app. This covers the work in **Google's Cloud Console**; the sign-in
flow itself is [AUTH-1](SPEC.md#auth-1-registration--sign-in-methods).

The server reads two values from `server/.env` (see
[server/.env.example](../server/.env.example)):

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`

These are an **OAuth 2.0 client**, which is different from the plain API keys
in [GOOGLE_API_KEYS.md](GOOGLE_API_KEYS.md) (Gemini / STT / Translation). Create
them in the **same dedicated Google Cloud project** — reuse the `slide-machine`
project and dedicated ops account from
[GOOGLE_API_KEYS.md §1](GOOGLE_API_KEYS.md#1-one-time-project-setup); don't make
a new project just for this.

> **One client, reused later.** This same OAuth client is also used for
> connected Google Drive import/export ([EXP-4](SPEC.md#exp-4-connected-accounts-google-drive)),
> which just requests broader scopes at consent time. Set it up once here for
> sign-in; no second client is needed for Drive.

## 1. Configure the OAuth consent screen

Google shows this screen to users the first time they sign in. It must exist
before you can create a client.

1. **Cloud Console → APIs & Services → OAuth consent screen** (with the
   `slide-machine` project selected).
2. **User Type:**
   - Choose **External** so that *any* Google account — personal Gmail **and**
     NYU Workspace — can sign in. This is the right choice for the pilot, which
     mixes NYU and non-NYU users.
   - (Choose **Internal** only if you deliberately want to restrict sign-in to a
     single Google Workspace organization, and you are creating the client
     inside that org. That would exclude non-org accounts.)
3. **App information:** app name `Slide Machine`, a support email, and an app
   logo if you have one. The app name and logo appear on the consent screen.
4. **App domain / links:** add the app's homepage URL and, for production, links
   to a privacy policy and terms page. Required before the app can be published
   (step 5).
5. **Authorized domains:** add your production domain (e.g.
   `ondigitalocean.app` or your custom domain). Not required for `localhost`
   testing.
6. **Scopes:** add the three basic sign-in scopes — **`openid`**,
   **`.../auth/userinfo.email`**, and **`.../auth/userinfo.profile`**. These
   return the verified email, name, and avatar the app needs to create an
   account. (Drive scopes for [EXP-4](SPEC.md#exp-4-connected-accounts-google-drive)
   are added later, not now.)
7. **Test users:** while the consent screen is in **Testing** mode, only accounts
   you list here can sign in. Add the team's and pilot testers' Google emails.
8. **Publishing status:** keep it in **Testing** for development. Before the Fall
   pilot, click **Publish app** to move to **In production** so any user can sign
   in without being a listed test user. Basic scopes (email/profile/openid) do
   **not** require Google's app-verification review; the broader Drive scopes
   later may.

## 2. Create the OAuth 2.0 Client ID

1. **Cloud Console → APIs & Services → Credentials** (same project) →
   **+ Create credentials → OAuth client ID**.
2. **Application type: Web application.**
3. Name it `slide-machine-web`.
4. **Authorized JavaScript origins** — the origins the browser loads the app
   from. Add:
   - `http://localhost:5173` — Vite dev server
   - `http://localhost:3000` — Express serving the built SPA (prod-like local run)
   - `https://<your-production-domain>` — e.g. the DigitalOcean App Platform URL
5. **Authorized redirect URIs** — where Google returns the user after they
   approve. The app uses the server-side **Authorization Code flow**, so these
   point at the Express **backend callback**, not the SPA. Add:
   - `http://localhost:3000/api/auth/google/callback` — dev
   - `https://<your-production-domain>/api/auth/google/callback` — production
6. **Create.** Copy the **Client ID** and **Client secret** shown in the dialog.
   The secret is shown once — treat it like a password.

> **The redirect URI must match exactly.** The path above
> (`/api/auth/google/callback`) is the convention the auth code will use; the
> string registered here must be byte-for-byte identical to what the server
> sends — scheme, host, port, and path. A mismatch produces Google's
> `redirect_uri_mismatch` error. Update this list whenever the domain or path
> changes.

## 3. Wire into the app

In `server/.env`:

```bash
GOOGLE_OAUTH_CLIENT_ID=<client id from step 2>
GOOGLE_OAUTH_CLIENT_SECRET=<client secret from step 2>
```

Restart the server; config is validated at boot by
[server/src/config/env.ts](../server/src/config/env.ts). In
Docker/DigitalOcean, set these as platform environment variables/secrets
instead of a committed file (`.env` is gitignored).

## 4. Housekeeping

- **Never commit the client secret.** Rotate it at **Credentials →** the client
  **→ Reset secret** (or add a second secret, deploy, then remove the old one).
- **Adding an environment** (staging, a new domain) means adding its origin and
  redirect URI in step 2 — the client can hold several of each.
- **Same IAM as the API keys:** coworkers with Owner/Editor on the project
  (GOOGLE_API_KEYS.md §6) can view and reset this client too.
- **NYU accounts** sign in through the same **External** client with no extra
  configuration; a user's verified NYU email resolves to their account like any
  other verified Google email (AUTH-1).
