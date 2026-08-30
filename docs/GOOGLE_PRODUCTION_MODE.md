# Testing → Production: publishing the Google OAuth app

How to move the `slide-machine` Cloud project's OAuth app from **Testing**
(only listed test users) to **In production** (any Google account), and what
that costs. Setup of the client itself is in
[GOOGLE_SIGN_IN.md](GOOGLE_SIGN_IN.md); the connected-account scopes are in
[GOOGLE_API_KEYS.md §6](GOOGLE_API_KEYS.md#6-connected-account-access-forms-drive--slides-exp-4).

> **Clicking "Publish app" takes a minute. Getting the app *verified* is the
> project** — weeks, and for one of our scopes, a paid annual security audit.
> They are separate things, and publishing without verification leaves the app
> capped at **100 users** with a red "Google hasn't verified this app" screen.
> Read §1 before scheduling anything.

## 1. Two consents, two paths

The app asks for Google's permission twice, and only one of them is expensive.

| Consent | Scopes requested | Google's class | Cost to open up |
| --- | --- | --- | --- |
| **Sign-in** ([AUTH-1](SPEC.md#auth-1-registration--sign-in-methods), [google.ts](../server/src/auth/google.ts)) | `openid`, `userinfo.email`, `userinfo.profile` | Non-sensitive | **None.** No review, no cap |
| **Connect** ([EXP-4](SPEC.md#exp-4-connected-accounts-google-drive), [google-connect.ts](../server/src/auth/google-connect.ts)) | `forms.body`, `forms.body.readonly` | Sensitive | Verification review — days to weeks |
| | `drive.file` | Non-sensitive | — |
| | `drive.readonly` | **Restricted** | Verification **plus** an annual third-party security assessment (CASA) |

So the transition splits in two, and you can ship the first half now:

- **Sign-in for everyone** — publish, done. Nothing to review.
- **Drive/Forms connect for everyone** — publish, then verify, and budget for
  CASA for as long as `drive.readonly` is in `CONNECT_SCOPES`. Until that
  finishes, connect works for at most 100 accounts behind a warning screen.

Take the **Sensitive / Restricted** label the console shows next to each scope
as authoritative — Google reclassifies scopes, and the table above is a
snapshot. **Before budgeting for any of it, read §6:** every scope in that
table except `drive.readonly` turns out to be avoidable, and `drive.readonly`
buys one feature.

## 2. First, check what is actually blocked today

Do not assume login is currently gated. Google exempts authorization requests
that ask for **only** the basic identity scopes from the test-user allowlist,
which may already describe our sign-in flow.

**Run the control before planning around it:** on the production deployment,
sign in with a Google account that is **not** on the test-user list and never
has been (borrow a personal Gmail). Then, as that account, try **Connect
Google** in the quiz/export flow.

- Sign-in succeeds, connect fails → only connect is gated. Publishing is still
  worth doing (it removes the 7-day refresh-token expiry, §6), but the real
  work is verification.
- Both fail → the allowlist is gating everything; publishing fixes sign-in
  immediately.

An account already on the test-user list proves nothing here — it worked
before. The account has to be one the current configuration should reject.

## 3. Pre-flight: what must be true before you publish

Verification is refused for missing versions of any of these, and the review
queue is slow enough that you do not want a second lap.

### 3.1 A custom domain you can verify

**This is the blocker most likely to be sitting in your way.** Verification
requires the homepage, privacy policy and terms to sit on an **authorized
domain**, and an authorized domain must be one you have verified ownership of
in Google Search Console. `slide-machine-xxxxx.ondigitalocean.app` cannot be:
`ondigitalocean.app` is DigitalOcean's top private domain, not yours.

1. Register a domain and attach it — DO dashboard → app → **Settings →
   Domains** ([DEPLOY.md §6](DEPLOY.md#6-register-the-google-oauth-redirect-uri)).
2. Set `PUBLIC_BASE_URL` to `https://<domain>` and redeploy.
3. Add `https://<domain>/api/auth/google/callback` to the OAuth client's
   **Authorized redirect URIs**, and `https://<domain>` to **Authorized
   JavaScript origins**. Byte-for-byte, or you get `redirect_uri_mismatch`.
4. Verify the domain at <https://search.google.com/search-console> as a
   **Domain property** (DNS TXT record), signed in as the Google account that
   owns the Cloud project. A "URL prefix" property is not accepted.

### 3.2 The public pages must be real

The homepage, `/privacy` and `/terms` must be publicly reachable without
logging in (they are — see [App.tsx](../client/src/App.tsx)), on the domain
above, and linked from the consent screen.

- Fill `OPERATOR_NAME`, `OPERATOR_JURISDICTION`, `OPERATOR_CONTACT_EMAIL`,
  `OPERATOR_POSTAL_ADDRESS` ([DEPLOY.md §5](DEPLOY.md#5-environment-variables)).
  Left blank, the live page shows `[Operator legal name]` — a reviewer reading
  that will fail the app.
- The privacy policy must **specifically disclose how the app accesses, uses,
  stores and shares Google user data**, and, because of `drive.readonly`, must
  satisfy Google's **Limited Use** requirements. Generic boilerplate is a
  common rejection. The wording lives in
  [client/src/content/](../client/src/content/).
- Decide what to do about the **draft banner** both pages carry until a lawyer
  has read them. Shipping it to a reviewer is a risk; removing it before
  review is a legal decision, not a docs one.

### 3.3 Branding and scopes in the console

Cloud Console → **Google Auth Platform** (this is where "APIs & Services →
OAuth consent screen" moved during 2025; the tabs are **Branding / Audience /
Clients / Data Access / Verification Center**).

- **Branding** — app name `Slide Machine`, logo, support email, app home page,
  privacy policy and terms links, and the authorized domain from §3.1.
- **Data Access** — the declared scopes must match what the code actually
  requests, no more. Today that is the seven in the §1 table. A scope declared
  but unused is a rejection; a scope used but undeclared fails at consent
  time. Enable a scope's API first or it will not appear in the picker.

## 4. Publish

1. **Google Auth Platform → Audience.**
2. Under **Publishing status: Testing**, click **Publish app**.
3. Confirm. Status becomes **In production**.

That is the whole step. The **test users** list stays where it is — it simply
stops gating access, and starts gating again if you ever go **Back to
testing**. Leave the entries in place.

What is true the moment you publish:

- Any Google account can complete the **sign-in** consent.
- Refresh tokens stop expiring after 7 days (§6).
- The **connect** consent, because it requests sensitive and restricted
  scopes, now shows the unverified-app warning screen, hides the app name and
  logo, and is capped at **100 users total** until verification completes.

## 5. Verification

Only needed for the connect scopes. Start it from **Google Auth Platform →
Verification Center**.

1. **Brand verification** — confirms the app name, logo and domain. Usually
   2–3 business days, sometimes minutes.
2. **Scope justification** — for each sensitive/restricted scope, one or two
   sentences on what the app does with it. The "Why" column of the
   [GOOGLE_API_KEYS.md §6 scope table](GOOGLE_API_KEYS.md#scopes-to-request-on-the-connect-flow)
   is written for exactly this.
3. **Demo video** — upload to YouTube as **Unlisted** and link it. It must:
   - be in English, and show the OAuth grant flow a real user sees;
   - show the browser address bar with the correct **app name** and **OAuth
     client ID** visible in the consent URL;
   - demonstrate, in the running app, the feature each sensitive and
     restricted scope enables — quiz publishing to Forms, export to Drive, the
     folder picker, and Slides import.
4. **Review** — sensitive scopes take days to weeks; restricted scopes
   "several weeks".

> **The 7-day publish window.** Once verification results come back compliant,
> you have **7 days** to publish, or the status flips to *Need to re-verify*
> and you go round again. Do not start a review the week before everyone
> disappears for a break.

## 6. Do we actually need the expensive scopes?

Mostly no. Every Google API method this app calls also accepts `drive.file`,
which is **non-sensitive**. Verified against Google's own method reference:

| What the app calls | Where | Accepts `drive.file`? |
| --- | --- | --- |
| `forms.create`, `forms.batchUpdate`, `forms.get` | `google-forms-quiz-tool` → [quiz-google.ts](../server/src/lib/quiz-google.ts) | **Yes** — all three |
| `presentations.get` | [read-slides.ts](../server/src/import/read-slides.ts) | **Yes** |
| `files.get`, `files.get?alt=media`, `files.copy` | [drive-file.ts](../server/src/lib/drive-file.ts) | **Yes**, for files the user picked |
| `files.list` (browse the Drive tree) | [quiz-google.ts](../server/src/lib/quiz-google.ts) | **No** — this is the one |

### `forms.body` / `forms.body.readonly` are dead weight

They are the library's own standalone-CLI constant
(`google-forms-quiz-tool/dist/lib/google-auth.js`), and the server never uses
that auth path — it injects its own `OAuth2Client`. The app only ever
**creates** a Form and later deletes it by the id it stored
([quiz.ts](../server/src/actions/quiz.ts)); it never opens a Form somebody
else made. `drive.file` covers create, batchUpdate and get on an app-created
file, so dropping both `forms.*` scopes costs nothing today.

The condition to watch: the day the app edits or reads a Form it did not
create, `drive.file` stops being enough.

### `drive.readonly` buys exactly one thing: our own file browser

`files.list` under `drive.file` returns only files this app created, so the
in-app Drive tree in [ExportPanel.tsx](../client/src/components/ExportPanel.tsx)
and [QuizPanel.tsx](../client/src/components/QuizPanel.tsx) — which walks real
folders per-parent via `drive.importables` and the quiz folder action — goes
empty without it. Everything downstream of the browse (read the file, copy a
`.pptx`, read a presentation) works fine under `drive.file`, because the
**Google Picker** grants per-file access to whatever the user chooses:

> *"Create new Drive files, or modify existing files, that you open with an app
> or that the user shares with an app while using the Google Picker API or the
> app's file picker."*

### What replacing it would cost

Swapping the custom browser for Google's hosted Picker leaves the app with
**no sensitive and no restricted scope at all** — no verification review, no
CASA, no 100-user cap, no danger screen. Only brand verification (§5, step 1) to
get the name and logo showing. Against that:

- **The in-app browser goes.** Picker is Google's own widget, loaded from
  Google's JS, styled by Google, and needs an API key plus an app id. Our
  folder tree, mock mode and its tests are replaced, not adapted.
- **Pasting a link stops working, and it is the main way in.** Both import
  panels are a single link field —
  [TemplateImport.tsx](../client/src/components/template/TemplateImport.tsx)
  parses what was pasted and routes it, and
  [LectureImport.tsx](../client/src/components/LectureImport.tsx) reuses that
  same `importSourceFrom`. The Drive browser is the alternative, not the
  default. Under `drive.file` a file the user never picked through the Picker
  is a 403, so:

  | Pasted | Under `drive.file` |
  | --- | --- |
  | A Slides link (`/presentation/d/…`) — TMPL-8, EXP-5 | **Breaks** |
  | A `/file/d/…` link to someone's `.pptx` | **Breaks** |
  | A `/file/d/…` link to a design file *this app exported* (EXP-3) | Works — the app created it |

  Uploading a `.pptx` from disk is unaffected: `readPptxLive` uploads the file
  itself, so it is app-created. The link field would become a "Choose from
  Drive" button, which is a deliberate design being undone — the two fields
  were merged into one link box on purpose. (`driveFileIdFrom` in
  [drive-file.ts](../server/src/lib/drive-file.ts) parses links too, but has no
  callers outside its own test; the live parsing is the client's.)
- **The browser needs its own access token.** Picker takes an API key, an app
  id (`setAppId`, the Cloud **project number**) and a `drive.file` access token
  via `setOAuthToken`. Our reads happen server-side from the stored refresh
  token, so the server would have to mint a short-lived access token and hand
  it to the page, or the page runs its own token flow. New plumbing either way.
- **Every instructor reconnects once**, as with any scope change.

#### What the spike must prove

The user still picks **any file they can see** — that is what the Picker is
for, and Google's own wording for `drive.file` is files "that the user shares
with an app while using the Google Picker API". The picker runs in Google's
iframe on the user's own session, so it lists their real Drive, not ours. Three
things are configuration-dependent enough to test rather than assume:

1. **The picked-file grant reaches the *server's* token.** The grant is to the
   OAuth client, keyed by `setAppId` — get that wrong and the classic symptom
   is a pick that succeeds followed by a backend `files.get` 404. Our
   browser-picks / server-reads split is exactly the shape that breaks.
2. **Which views work under `drive.file`** — My Drive, *Shared with me*,
   search, and shared drives (`Feature.SUPPORT_DRIVES`). "Shared with me"
   matters: today a pasted link reads a presentation the instructor can open
   but has never added to their Drive, and only that view preserves it.
3. **Destination folders.** `setSelectFolderEnabled` selects a folder, but
   confirm writing into a picked folder is really granted under `drive.file`.
   The zero-risk fallback is an app-created `Slide Machine` folder, which
   `drive.file` already covers — at the cost of instructors no longer choosing
   an arbitrary existing folder.

### If you keep `drive.readonly`

It is a **restricted** scope, so on top of the §5 review the app needs a
**security assessment** by a Google-approved third-party assessor under the App
Defense Alliance's CASA framework — because the app can reach Drive data from a
server. It is **paid** (roughly hundreds to low thousands of dollars a year, by
tier), takes weeks, and must be **redone every 12 months** from the assessor's
Letter of Assessment date or the scope is withdrawn.

Cost that recurring audit against one Picker migration before defaulting to it.

## 7. Confirm it actually took effect

Publishing changes nothing you can see from an account that already worked, so
neither can it be evidence.

| Check | Passes only if publishing happened |
| --- | --- |
| Sign in with a Google account never added as a test user | Yes — it was rejected before |
| Existing test users still sign in | **No** — identical before and after |
| Console shows *In production* | Yes, but only that the button was clicked |
| A connected account's refresh token still works on day 8+ | Yes — Testing capped it at 7 days |

The last one is the only proof that the offline-access half is fixed, and it
takes a week to collect. Note the date you publish, and check a real
connection afterwards rather than assuming.

## 8. Rolling back

**Audience → Back to testing.** Non-test users can no longer consent, the
test-user list gates access again, and newly issued refresh tokens go back to
expiring in 7 days. Grants already issued are not revoked, but treat any
production grant as unreliable after a rollback.

## 9. What does not change

- **No new OAuth client**, no `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` change, no
  secret rotation.
- **No new redirect URI** beyond adding the custom domain (§3.1) — connect
  reuses the sign-in callback deliberately.
- **No `CONNECTED_ACCOUNT_TOKEN_ENC_KEY` change.** Rotating it orphans every
  existing connection.
- **No code change**, unless you take the §6 alternative.

## References

- [OAuth app states overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)
- [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [Manage app audience](https://support.google.com/cloud/answer/15549945)
- [Domain verification](https://support.google.com/cloud/answer/13804266)
